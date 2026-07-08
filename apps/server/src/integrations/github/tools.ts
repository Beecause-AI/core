import {
  listProjectRepos,
  getIntegration,
  resolveRepoRef,
  credsForRow,
  type Db,
  type SlackClient,
} from '@intellilabs/core';
import type { GithubClient, Creds } from './client.js';
import { offerGithubIssue } from './offer-github-issue.js';

/** Server-side catalog wire shape. Distinct from the engine's provider.ToolDef; kind:'integration' is intentional and carried over the /int tool API. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  kind: 'integration';
  mutates: boolean;
}

export interface ToolCtx {
  db: Db;
  orgId: string;
  projectId: string;
  client: GithubClient;
  config: { SECRETS_KEY?: string; GITHUB_APP_ID?: string; GITHUB_APP_PRIVATE_KEY?: string };
  slackClient?: SlackClient;
  slackThread?: { channel: string; threadTs: string };
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

const obj = (props: Record<string, unknown>, required: string[]) =>
  ({ type: 'object', properties: props, required, additionalProperties: false });

const S = { type: 'string' } as const;

/** Static GitHub tool catalog. The agent never passes a ref — repo/path/query only. */
export function githubToolDefs(): ToolDef[] {
  const d = (name: string, description: string, parameters: Record<string, unknown>, mutates = false): ToolDef =>
    ({ name: `integration.github.${name}`, description, parameters, kind: 'integration', mutates });
  return [
    d('list_repos', 'List the repos this project can see, each with its resolved code version.', obj({}, [])),
    d('get_file', 'Read a file at the project-resolved ref.', obj({ repo: S, path: S }, ['repo', 'path'])),
    d('list_directory', 'List directory entries at the project-resolved ref.', obj({ repo: S, path: S }, ['repo', 'path'])),
    d('search_code', 'Search code in a repo (indexes the default branch).', obj({ repo: S, query: S }, ['repo', 'query'])),
    d('get_ref_info', 'Resolve the exact commit SHA this project reads for a repo.', obj({ repo: S }, ['repo'])),
    d('search_issues', 'Search issues in a repo.', obj({ repo: S, query: S }, ['repo', 'query'])),
    d('get_issue', 'Read one issue.', obj({ repo: S, number: { type: 'number' } }, ['repo', 'number'])),
    d('create_issue', 'Create an issue.', obj({ repo: S, title: S, body: S }, ['repo', 'title', 'body']), true),
    d('offer_github_issue',
      'After you have CONCLUDED the investigation and the problem is FIXABLE IN CODE, offer to raise a GitHub issue (it may be handed to GitHub Copilot, depending on how the project is configured). This posts a Yes/No prompt to the Slack reporter — call it once, as your final action, AFTER your written conclusion. Provide a complete title and body (root cause, affected files as file:line, how to reproduce, expected vs actual). Set repo to the repository where the fix belongs when you can identify it; omit repo to let the reporter choose. summary is one line shown on the prompt.',
      obj({ repo: S, title: S, body: S, summary: S }, ['title', 'body', 'summary']), false),
    d('list_pull_requests', 'List pull requests.', obj({ repo: S, state: S }, ['repo'])),
    d('get_pull_request', 'Read a pull request with its diff.', obj({ repo: S, number: { type: 'number' } }, ['repo', 'number'])),
    d('list_commits', 'List recent commits on a repo (newest first), filterable by file path and time window (since/until ISO). Use this to find the change that shipped around an incident.', obj({ repo: S, path: S, since: S, until: S, sha: S }, ['repo'])),
    d('get_commit', 'Read one commit: message, author, date, and the files it changed with diffs.', obj({ repo: S, sha: S }, ['repo', 'sha'])),
  ];
}

/** Drop offer_github_issue unless GitHub issue creation is enabled for this org+project+thread. */
export function filterGithubToolDefs(defs: ToolDef[], opts: { issuesEnabled: boolean }): ToolDef[] {
  return opts.issuesEnabled ? defs : defs.filter((d) => d.name !== 'integration.github.offer_github_issue');
}

/** Dispatch a github.* tool: enforce scope, inject ref, decrypt creds, call client. */
export async function callGithubTool(ctx: ToolCtx, name: string, rawArgs: unknown): Promise<ToolResult> {
  const args = (rawArgs ?? {}) as Record<string, any>;
  const bare = name.replace('integration.github.', '');

  const row = await getIntegration(ctx.db, ctx.orgId, 'github');
  if (!row) return { content: 'github not connected for this org', isError: true };
  const repos = (await listProjectRepos(ctx.db, ctx.projectId)).filter((r) => r.orgIntegrationId === row.id);

  if (bare === 'list_repos') {
    return { content: JSON.stringify(repos.map((r) => ({ repo: r.repoFullName, ref: resolveRepoRef(r) }))) };
  }

  if (bare === 'offer_github_issue') return offerGithubIssue(ctx, rawArgs);

  const repoArg = String(args.repo ?? '');
  const scoped = repos.find((r) => r.repoFullName === repoArg);
  if (!scoped) return { content: `repo ${repoArg} is not in project scope`, isError: true };

  const creds = credsForRow(row, ctx.config);
  const ref = resolveRepoRef(scoped);

  // Validate required args before dispatch so missing/garbage inputs return a clean ToolResult.
  if ((bare === 'get_file' || bare === 'list_directory') && !args.path)
    return { content: 'path is required', isError: true };
  if ((bare === 'search_code' || bare === 'search_issues') && !args.query)
    return { content: 'query is required', isError: true };
  if ((bare === 'get_issue' || bare === 'get_pull_request') && !Number.isInteger(Number(args.number)))
    return { content: 'number must be an integer', isError: true };
  if (bare === 'create_issue' && !args.title)
    return { content: 'title is required', isError: true };
  if (bare === 'get_commit' && !String(args.sha ?? '').trim())
    return { content: 'sha is required', isError: true };

  try {
    switch (bare) {
      case 'get_file': return { content: JSON.stringify(await ctx.client.getFile(creds, repoArg, String(args.path), ref)) };
      case 'list_directory': return { content: JSON.stringify(await ctx.client.listDirectory(creds, repoArg, String(args.path), ref)) };
      case 'get_ref_info': return { content: JSON.stringify(await ctx.client.getRefInfo(creds, repoArg, ref)) };
      case 'search_code': return { content: JSON.stringify(await ctx.client.searchCode(creds, repoArg, String(args.query))) };
      case 'search_issues': return { content: JSON.stringify(await ctx.client.searchIssues(creds, repoArg, String(args.query))) };
      case 'get_issue': return { content: JSON.stringify(await ctx.client.getIssue(creds, repoArg, Number(args.number))) };
      case 'create_issue': return { content: JSON.stringify(await ctx.client.createIssue(creds, repoArg, String(args.title), String(args.body ?? ''))) };
      case 'list_pull_requests': return { content: JSON.stringify(await ctx.client.listPullRequests(creds, repoArg, String(args.state ?? 'open'))) };
      case 'get_pull_request': return { content: JSON.stringify(await ctx.client.getPullRequest(creds, repoArg, Number(args.number))) };
      case 'list_commits': return { content: JSON.stringify(await ctx.client.listCommits(creds, repoArg, { path: args.path ? String(args.path) : undefined, since: args.since ? String(args.since) : undefined, until: args.until ? String(args.until) : undefined, sha: args.sha ? String(args.sha) : undefined, perPage: args.perPage ? Number(args.perPage) : undefined })) };
      case 'get_commit': return { content: JSON.stringify(await ctx.client.getCommit(creds, repoArg, String(args.sha))) };
      default: return { content: `unknown github tool: ${name}`, isError: true };
    }
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}
