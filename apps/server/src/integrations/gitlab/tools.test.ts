import { describe, it, expect, vi, beforeEach } from 'vitest';

const { listProjectRepos, getIntegration } = vi.hoisted(() => ({
  listProjectRepos: vi.fn(async () => [] as any[]),
  getIntegration: vi.fn(async () => ({ id: 'gl1', mode: 'access_token', secretCiphertext: 'ct', baseUrl: null }) as any),
}));
vi.mock('@intellilabs/core', () => ({
  listProjectRepos, getIntegration,
  resolveRepoRef: (r: any) => r.ref ?? r.defaultBranch ?? null,
  gitlabCredsForRow: () => ({ token: 'glpat' }),
}));
vi.mock('./offer-gitlab-issue.js', () => ({ offerGitlabIssue: vi.fn(async () => ({ content: 'offered' })) }));

import { gitlabToolDefs, filterGitlabToolDefs, callGitlabTool } from './tools.js';

const client = {
  getFile: vi.fn(async () => ({ text: 'x', sha: 's' })),
} as any;
const ctx = () => ({ db: {} as any, orgId: 'o1', projectId: 'p1', client, config: { SECRETS_KEY: 'k' } });

beforeEach(() => {
  vi.clearAllMocks();
  getIntegration.mockResolvedValue({ id: 'gl1', mode: 'access_token', secretCiphertext: 'ct', baseUrl: null });
  listProjectRepos.mockResolvedValue([{ repoFullName: 'g/r', orgIntegrationId: 'gl1', defaultBranch: 'main', ref: null }]);
});

describe('gitlabToolDefs', () => {
  it('defines 11 tools under integration.gitlab.*', () => {
    const names = gitlabToolDefs().map((d) => d.name);
    expect(names).toContain('integration.gitlab.list_repos');
    expect(names).toContain('integration.gitlab.get_merge_request');
    expect(names).toContain('integration.gitlab.offer_gitlab_issue');
    expect(names.length).toBe(11);
  });
  it('drops offer_gitlab_issue when issues disabled', () => {
    expect(filterGitlabToolDefs(gitlabToolDefs(), { issuesEnabled: false }).map((d) => d.name))
      .not.toContain('integration.gitlab.offer_gitlab_issue');
  });
});

describe('callGitlabTool scoping', () => {
  it('list_repos returns only gitlab-connection repos with resolved refs', async () => {
    listProjectRepos.mockResolvedValue([
      { repoFullName: 'g/r', orgIntegrationId: 'gl1', defaultBranch: 'main', ref: null },
      { repoFullName: 'gh/x', orgIntegrationId: 'gh-other', defaultBranch: 'main', ref: null },
    ]);
    const out = await callGitlabTool(ctx(), 'integration.gitlab.list_repos', {});
    expect(JSON.parse(out.content)).toEqual([{ repo: 'g/r', ref: 'main' }]);
  });
  it('rejects a repo not owned by the gitlab connection', async () => {
    const out = await callGitlabTool(ctx(), 'integration.gitlab.get_file', { repo: 'gh/x', path: 'a' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('not in project scope');
  });
  it('dispatches get_file for an in-scope gitlab repo', async () => {
    const out = await callGitlabTool(ctx(), 'integration.gitlab.get_file', { repo: 'g/r', path: 'a.ts' });
    expect(JSON.parse(out.content)).toEqual({ text: 'x', sha: 's' });
    expect(client.getFile).toHaveBeenCalledWith({ token: 'glpat' }, 'g/r', 'a.ts', 'main');
  });
});
