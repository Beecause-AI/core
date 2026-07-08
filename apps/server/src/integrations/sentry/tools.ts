import {
  getSentryProjectConnection, getSentryConnection, listSentryTargets,
  sentryCredsForConnection, sentryAuthHeaders, realSentryClient,
  type Db, type SentryClient,
} from '@intellilabs/core';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
export interface ToolResult { content: string; isError?: boolean; }
export interface SentryToolCtx {
  db: Db; orgId: string; projectId: string;
  config: { SECRETS_KEY?: string };
  client?: SentryClient;
}

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;
const N = { type: 'number' } as const;

export function sentryToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>): ToolDef =>
    ({ name: `integration.sentry.${name}`, description, parameters, kind: 'integration', mutates: false });
  return [
    d('list_scope', "List what this project's assistants can query: the Sentry organization and the allowed Sentry projects (or 'unrestricted' = any project the connection's token can reach).", obj({}, [])),
    d('list_issues', "List grouped Sentry issues (errors) for a project. `project` is a Sentry project slug in scope (see list_scope). `query` is Sentry search syntax (e.g. \"is:unresolved\"); `statsPeriod` bounds the window (e.g. \"24h\", \"14d\"); `sort` is one of date|new|freq|priority; `limit` caps rows.", obj({ project: S, query: S, statsPeriod: S, sort: S, limit: N }, ['project'])),
    d('get_issue', 'Read one Sentry issue by id (culprit, level, status, counts, first/last seen). The id comes from list_issues. Scoped to the project allow-list.', obj({ issueId: S }, ['issueId'])),
    d('get_latest_event', 'Read the latest event of a Sentry issue: the stack trace, breadcrumbs, tags, contexts, and request — the payload that links the error to code. The id comes from list_issues. Scoped to the project allow-list.', obj({ issueId: S }, ['issueId'])),
  ];
}

/** Sentry tools are offered whenever the project has a connection binding. */
export function filterSentryToolDefs(defs: ToolDef[], hasConnection: boolean): ToolDef[] {
  return hasConnection ? defs : [];
}

export async function callSentryTool(ctx: SentryToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.sentry.', '');

  const binding = await getSentryProjectConnection(ctx.db, ctx.projectId);
  if (!binding) return { content: 'no Sentry connection configured for this project', isError: true };

  let headers: Record<string, string>;
  let baseUrl: string;
  let orgSlug: string | undefined;
  try {
    const conn = await getSentryConnection(ctx.db, ctx.orgId, binding.connectionId);
    if (!conn) return { content: 'Sentry connection not found', isError: true };
    headers = sentryAuthHeaders(sentryCredsForConnection(conn, ctx.config));
    baseUrl = conn.baseUrl;
    orgSlug = (conn.metadata as { sentryOrgSlug?: string })?.sentryOrgSlug;
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
  if (!orgSlug) return { content: 'Sentry connection has no organization slug', isError: true };

  const targets = await listSentryTargets(ctx.db, ctx.projectId);
  const allowed = new Set(targets.map((t) => t.sentryProjectSlug));
  const unrestricted = targets.length === 0;
  const outOfScope = (slug: string | undefined): boolean => !unrestricted && (!slug || !allowed.has(slug));

  const client = ctx.client ?? realSentryClient;

  if (bare === 'list_scope') {
    return { content: JSON.stringify({
      org: orgSlug ?? null,
      unrestricted,
      projects: targets.map((t) => ({ slug: t.sentryProjectSlug, name: t.name })),
    }) };
  }

  try {
    switch (bare) {
      case 'list_issues': {
        const project = String(args.project ?? '');
        if (!project) return { content: 'project is required', isError: true };
        if (outOfScope(project)) return { content: `project ${project} is not in this project's scope`, isError: true };
        const issues = await client.listIssues(baseUrl, headers, orgSlug, project, {
          query: args.query, statsPeriod: args.statsPeriod, sort: args.sort, limit: args.limit,
        });
        return { content: JSON.stringify(issues) };
      }
      case 'get_issue': {
        const issueId = String(args.issueId ?? '');
        if (!issueId) return { content: 'issueId is required', isError: true };
        const issue = await client.getIssue(baseUrl, headers, orgSlug, issueId);
        const slug = (issue as { project?: { slug?: string } })?.project?.slug;
        if (outOfScope(slug)) return { content: `issue ${issueId} is not in this project's scope`, isError: true };
        return { content: JSON.stringify(issue) };
      }
      case 'get_latest_event': {
        const issueId = String(args.issueId ?? '');
        if (!issueId) return { content: 'issueId is required', isError: true };
        // Defense-in-depth: issue ids are org-global, so when restricted, resolve the
        // issue's project first and reject before fetching the (large) event payload.
        if (!unrestricted) {
          const issue = await client.getIssue(baseUrl, headers, orgSlug, issueId);
          const slug = (issue as { project?: { slug?: string } })?.project?.slug;
          if (outOfScope(slug)) return { content: `issue ${issueId} is not in this project's scope`, isError: true };
        }
        const event = await client.getLatestEvent(baseUrl, headers, orgSlug, issueId);
        return { content: JSON.stringify(event) };
      }
      default:
        return { content: `unknown sentry tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
