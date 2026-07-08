import { listProjectRepos, getIntegration, resolveRepoRef, gitlabCredsForRow, type Db } from '@intellilabs/core';
import type { GitlabClient } from './client.js';
import { offerGitlabIssue } from './offer-gitlab-issue.js';

export interface ToolDef { name: string; description: string; parameters: Record<string, unknown>; kind: 'integration'; mutates: boolean; }
export interface ToolCtx {
  db: Db; orgId: string; projectId: string; client: GitlabClient;
  config: { SECRETS_KEY?: string };
  slackThread?: { channel: string; threadTs: string };
}
export interface ToolResult { content: string; isError?: boolean; }

const obj = (props: Record<string, unknown>, required: string[]) => ({ type: 'object', properties: props, required, additionalProperties: false });
const S = { type: 'string' } as const;

export function gitlabToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>, mutates = false): ToolDef =>
    ({ name: `integration.gitlab.${name}`, description, parameters, kind: 'integration', mutates });
  return [
    d('list_repos', 'List the GitLab repositories this project can see, each with its resolved code version.', obj({}, [])),
    d('get_file', 'Read a file at the project-resolved ref.', obj({ repo: S, path: S }, ['repo', 'path'])),
    d('list_directory', 'List directory entries at the project-resolved ref.', obj({ repo: S, path: S }, ['repo', 'path'])),
    d('search_code', 'Search code (blobs) in a repo.', obj({ repo: S, query: S }, ['repo', 'query'])),
    d('get_ref_info', 'Resolve the exact commit SHA this project reads for a repo.', obj({ repo: S }, ['repo'])),
    d('search_issues', 'Search issues in a repo.', obj({ repo: S, query: S }, ['repo', 'query'])),
    d('get_issue', 'Read one issue.', obj({ repo: S, number: { type: 'number' } }, ['repo', 'number'])),
    d('create_issue', 'Create an issue.', obj({ repo: S, title: S, body: S }, ['repo', 'title', 'body']), true),
    d('offer_gitlab_issue',
      'After you have CONCLUDED the investigation and the problem is FIXABLE IN CODE, offer to raise a GitLab issue. This posts a Yes/No prompt to the Slack reporter — call it once, as your final action, AFTER your written conclusion. Provide a complete title and body (root cause, affected files as file:line, how to reproduce, expected vs actual). Set repo to the repository where the fix belongs when you can identify it; omit repo to let the reporter choose. summary is one line shown on the prompt.',
      obj({ repo: S, title: S, body: S, summary: S }, ['title', 'body', 'summary']), false),
    d('list_merge_requests', 'List merge requests.', obj({ repo: S, state: S }, ['repo'])),
    d('get_merge_request', 'Read a merge request with its diff.', obj({ repo: S, number: { type: 'number' } }, ['repo', 'number'])),
  ];
}

export function filterGitlabToolDefs(defs: ToolDef[], opts: { issuesEnabled: boolean }): ToolDef[] {
  return opts.issuesEnabled ? defs : defs.filter((d) => d.name !== 'integration.gitlab.offer_gitlab_issue');
}

export async function callGitlabTool(ctx: ToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.gitlab.', '');

  const row = await getIntegration(ctx.db, ctx.orgId, 'gitlab');
  if (!row) return { content: 'gitlab not connected for this org', isError: true };
  // project_repos holds repos for every provider; scope to this connection's repos only.
  const repos = (await listProjectRepos(ctx.db, ctx.projectId)).filter((r) => r.orgIntegrationId === row.id);

  if (bare === 'list_repos') {
    return { content: JSON.stringify(repos.map((r) => ({ repo: r.repoFullName, ref: resolveRepoRef(r) }))) };
  }
  if (bare === 'offer_gitlab_issue') return offerGitlabIssue(ctx, rawArgs);

  const repoArg = String(args.repo ?? '');
  const scoped = repos.find((r) => r.repoFullName === repoArg);
  if (!scoped) return { content: `repo ${repoArg} is not in project scope`, isError: true };

  const creds = gitlabCredsForRow(row, ctx.config);
  const ref = resolveRepoRef(scoped);

  if ((bare === 'get_file' || bare === 'list_directory') && !args.path) return { content: 'path is required', isError: true };
  if ((bare === 'search_code' || bare === 'search_issues') && !args.query) return { content: 'query is required', isError: true };
  if ((bare === 'get_issue' || bare === 'get_merge_request') && !Number.isInteger(Number(args.number))) return { content: 'number must be an integer', isError: true };
  if (bare === 'create_issue' && !args.title) return { content: 'title is required', isError: true };

  try {
    switch (bare) {
      case 'get_file': return { content: JSON.stringify(await ctx.client.getFile(creds, repoArg, String(args.path), ref)) };
      case 'list_directory': return { content: JSON.stringify(await ctx.client.listDirectory(creds, repoArg, String(args.path), ref)) };
      case 'get_ref_info': return { content: JSON.stringify(await ctx.client.getRefInfo(creds, repoArg, ref)) };
      case 'search_code': return { content: JSON.stringify(await ctx.client.searchCode(creds, repoArg, String(args.query))) };
      case 'search_issues': return { content: JSON.stringify(await ctx.client.searchIssues(creds, repoArg, String(args.query))) };
      case 'get_issue': return { content: JSON.stringify(await ctx.client.getIssue(creds, repoArg, Number(args.number))) };
      case 'create_issue': return { content: JSON.stringify(await ctx.client.createIssue(creds, repoArg, String(args.title), String(args.body ?? ''))) };
      case 'list_merge_requests': return { content: JSON.stringify(await ctx.client.listMergeRequests(creds, repoArg, String(args.state ?? 'open'))) };
      case 'get_merge_request': return { content: JSON.stringify(await ctx.client.getMergeRequest(creds, repoArg, Number(args.number))) };
      default: return { content: `unknown gitlab tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
