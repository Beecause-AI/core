import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, createProject, upsertIntegration, getIntegration, addProjectRepo, encryptSecret, keyFromBase64, findOrCreateSlackConversation, setIntegrationIssuesEnabled, setProjectIssuesEnabled, getCopilotIssueOffer } from '@intellilabs/core';
import { githubToolDefs, callGithubTool, filterGithubToolDefs, type ToolCtx } from '../src/integrations/github/tools.js';
import { startTestDb, testConfig } from './helpers.js';
import type { SlackClient } from '@intellilabs/core';

const client = {
  getFile: async (_c: any, repo: string, path: string, ref: string | null) => ({ text: `${repo}:${path}@${ref}`, sha: 's' }),
  createIssue: async (_c: any, _repo: string, _title: string, _body: string) => ({ number: 1, url: 'u' }),
} as any;

const noopSlack: SlackClient = {
  async oauthAccess() { return { ok: false, error: 'x' }; },
  async authTest() { return { ok: false, error: 'x' }; },
  async chatPostMessage() { return { ok: true, ts: '0.0' }; },
  async chatUpdate() { return { ok: true }; },
};

let t: Awaited<ReturnType<typeof startTestDb>>;
let ctx: ToolCtx;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  t = await startTestDb();

  // Seed org + project + github integration + project repo
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
  orgId = org.id;

  const proj = await createProject(t.db, org.id, { name: 'Web', slug: 'web' });
  projectId = proj.id;

  // Encrypt a dummy token so credsFor can decrypt it for the allowed-repo path;
  // the stub client ignores the creds. The denied-repo path never reaches credsFor.
  const secretsKey = Buffer.alloc(32, 1);
  const secretCiphertext = encryptSecret('ghp_dummy', secretsKey);
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'github',
    mode: 'pat',
    secretCiphertext,
    connectedByUserId: 'u1',
    metadata: {},
  });
  const intg = await getIntegration(t.db, org.id, 'github');

  await addProjectRepo(t.db, {
    projectId: proj.id,
    orgIntegrationId: intg!.id,
    repoFullName: 'acme/web',
    defaultBranch: 'main',
    addedByUserId: 'u1',
  });

  // Seed a second repo for copilot-issue "no repo" test
  await addProjectRepo(t.db, {
    projectId: proj.id,
    orgIntegrationId: intg!.id,
    repoFullName: 'acme/api',
    defaultBranch: 'main',
    addedByUserId: 'u1',
  });

  // Seed a Slack integration with an encrypted bot token (same SECRETS_KEY = Buffer.alloc(32,1))
  const slackCiphertext = encryptSecret('xoxb-test-copilot', secretsKey);
  await upsertIntegration(t.db, {
    orgId: org.id,
    provider: 'slack',
    mode: 'oauth',
    accountLabel: 'Acme Slack',
    secretCiphertext: slackCiphertext,
    metadata: { teamId: 'T1', botUserId: 'U_BOT' },
    lastTestOk: true,
  });

  // Seed a Slack conversation so getSlackConversation resolves
  await findOrCreateSlackConversation(t.db, {
    orgId: org.id,
    projectId: proj.id,
    assistantId: null,
    slackChannelId: 'C1',
    slackThreadTs: '111.1',
  });

  // Turn issue creation ON so the happy-path offer_github_issue tests pass
  // (enable issue creation at the org + project layers).
  await setIntegrationIssuesEnabled(t.db, org.id, 'github', true);
  await setProjectIssuesEnabled(t.db, org.id, proj.id, true);

  ctx = {
    db: t.db,
    orgId: org.id,
    projectId: proj!.id,
    client,
    config: {
      ...testConfig,
      SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
    },
  };
});

afterAll(async () => { await t.stop(); });

describe('github tools', () => {
  it('exposes namespaced defs with mutates flags', () => {
    const defs = githubToolDefs();
    expect(defs.find((d) => d.name === 'integration.github.get_file')!.mutates).toBe(false);
    expect(defs.find((d) => d.name === 'integration.github.create_issue')!.mutates).toBe(true);
    expect(defs.find((d) => d.name === 'integration.github.offer_github_issue')!.mutates).toBe(false);
  });

  it('injects the resolved ref and enforces repo scope', async () => {
    const ok = await callGithubTool(ctx, 'integration.github.get_file', { repo: 'acme/web', path: 'README.md' });
    expect(ok.isError).toBeFalsy();
    expect(ok.content).toContain('acme/web:README.md@main');

    const denied = await callGithubTool(ctx, 'integration.github.get_file', { repo: 'acme/secret', path: 'x' });
    expect(denied.isError).toBe(true);
    expect(denied.content).toContain('not in project scope');
  });

  it('create_issue happy path returns the new issue number', async () => {
    const result = await callGithubTool(ctx, 'integration.github.create_issue', { repo: 'acme/web', title: 'T', body: 'B' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('"number":1');
  });

  it('returns isError when a required arg is missing', async () => {
    const result = await callGithubTool(ctx, 'integration.github.get_file', { repo: 'acme/web' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('path is required');
  });
});

describe('filterGithubToolDefs', () => {
  it('keeps offer_github_issue when issuesEnabled is true', () => {
    const defs = githubToolDefs();
    const filtered = filterGithubToolDefs(defs, { issuesEnabled: true });
    expect(filtered.find((d) => d.name === 'integration.github.offer_github_issue')).toBeDefined();
  });

  it('drops offer_github_issue when issuesEnabled is false', () => {
    const defs = githubToolDefs();
    const filtered = filterGithubToolDefs(defs, { issuesEnabled: false });
    expect(filtered.find((d) => d.name === 'integration.github.offer_github_issue')).toBeUndefined();
    // other tools survive
    expect(filtered.find((d) => d.name === 'integration.github.get_file')).toBeDefined();
  });
});

describe('list_commits and get_commit tools', () => {
  const commitClient = {
    listCommits: async (_c: any, repo: string, opts: any) => [
      { sha: 'abc123', shortSha: 'abc123', message: 'feat: thing', author: 'alice', date: '2024-01-01T00:00:00Z', url: `https://github.com/${repo}/commit/abc123` },
    ],
    getCommit: async (_c: any, repo: string, sha: string) => ({
      sha,
      message: 'feat: thing',
      author: 'alice',
      date: '2024-01-01T00:00:00Z',
      url: `https://github.com/${repo}/commit/${sha}`,
      stats: { additions: 1, deletions: 0, total: 1 },
      files: [{ filename: 'a.ts', status: 'modified', additions: 1, deletions: 0, patch: '+foo' }],
    }),
  } as any;

  let commitCtx: ToolCtx;

  beforeAll(async () => {
    // reuse the same t.db, org, project set up in the outer beforeAll
    commitCtx = { ...ctx, client: commitClient };
  });

  it('list_commits def is present in githubToolDefs and not gated by issuesEnabled', () => {
    const defs = githubToolDefs();
    expect(defs.find((d) => d.name === 'integration.github.list_commits')).toBeDefined();
    // survives the issues=false filter (it is a read tool, not issue-gated)
    const filtered = filterGithubToolDefs(defs, { issuesEnabled: false });
    expect(filtered.find((d) => d.name === 'integration.github.list_commits')).toBeDefined();
  });

  it('get_commit def is present in githubToolDefs and not gated by issuesEnabled', () => {
    const defs = githubToolDefs();
    expect(defs.find((d) => d.name === 'integration.github.get_commit')).toBeDefined();
    const filtered = filterGithubToolDefs(defs, { issuesEnabled: false });
    expect(filtered.find((d) => d.name === 'integration.github.get_commit')).toBeDefined();
  });

  it('list_commits routes to client.listCommits and returns results', async () => {
    const result = await callGithubTool(commitCtx, 'integration.github.list_commits', { repo: 'acme/web' });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].sha).toBe('abc123');
  });

  it('list_commits rejects a repo not in project scope', async () => {
    const result = await callGithubTool(commitCtx, 'integration.github.list_commits', { repo: 'other/secret' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not in project scope');
  });

  it('get_commit routes to client.getCommit and returns the commit', async () => {
    const result = await callGithubTool(commitCtx, 'integration.github.get_commit', { repo: 'acme/web', sha: 'abc123' });
    expect(result.isError).toBeFalsy();
    const parsed = JSON.parse(result.content);
    expect(parsed.sha).toBe('abc123');
    expect(Array.isArray(parsed.files)).toBe(true);
  });

  it('get_commit rejects a repo not in project scope', async () => {
    const result = await callGithubTool(commitCtx, 'integration.github.get_commit', { repo: 'evil/repo', sha: 'abc123' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not in project scope');
  });

  it('get_commit returns isError when sha is empty', async () => {
    const result = await callGithubTool(commitCtx, 'integration.github.get_commit', { repo: 'acme/web', sha: '' });
    expect(result.isError).toBe(true);
  });
});

describe('offer_github_issue', () => {
  it('with a valid repo: records a queued offer and posts nothing in-tool (deferred to after the reply)', async () => {
    const posted: any[] = [];
    const slackClient: SlackClient = {
      async oauthAccess() { return { ok: false, error: 'x' }; },
      async authTest() { return { ok: false, error: 'x' }; },
      async chatPostMessage(_t, m) { posted.push(m); return { ok: true, ts: '999.9' }; },
      async chatUpdate() { return { ok: true }; },
    };
    const res = await callGithubTool(
      { ...ctx, slackClient, slackThread: { channel: 'C1', threadTs: '111.1' } },
      'integration.github.offer_github_issue',
      { repo: 'acme/api', title: 'T', body: 'B', summary: 'Raise a fix?' },
    );
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.status).toBe('offered');
    expect(parsed.mode).toBe('queue');
    expect(posted).toHaveLength(0); // queued: not posted during the turn
    const offer = await getCopilotIssueOffer(ctx.db, parsed.offerId);
    expect(offer?.repo).toBe('acme/api');
    expect(offer?.slackMessageTs).toBeNull(); // posted later by slack-delivery
  });

  it('rejects a repo not in project scope', async () => {
    const res = await callGithubTool(
      { ...ctx, slackClient: noopSlack, slackThread: { channel: 'C1', threadTs: '111.1' } },
      'integration.github.offer_github_issue',
      { repo: 'evil/x', title: 'T', body: 'B', summary: 's' },
    );
    expect(res.isError).toBe(true);
  });

  it('with no repo: records a queued offer carrying candidate repos (no in-tool post)', async () => {
    const posted: any[] = [];
    const slackClient: SlackClient = {
      async oauthAccess() { return { ok: false, error: 'x' }; },
      async authTest() { return { ok: false, error: 'x' }; },
      async chatPostMessage(_t, m) { posted.push(m); return { ok: true, ts: '1.1' }; },
      async chatUpdate() { return { ok: true }; },
    };
    const res = await callGithubTool(
      { ...ctx, slackClient, slackThread: { channel: 'C1', threadTs: '111.1' } },
      'integration.github.offer_github_issue',
      { title: 'T', body: 'B', summary: 's' },
    );
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.mode).toBe('queue');
    expect(posted).toHaveLength(0);
    const offer = await getCopilotIssueOffer(ctx.db, parsed.offerId);
    expect(offer?.repo).toBeNull();
    expect((offer?.candidateRepos ?? []).length).toBeGreaterThan(0); // rendered into a repo-select at post time
  });

  it('fails if slackThread is missing from ctx', async () => {
    const res = await callGithubTool(
      ctx,
      'integration.github.offer_github_issue',
      { title: 'T', body: 'B', summary: 's' },
    );
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Slack');
  });

  it('returns isError when the issue-creation gate is OFF and posts no Slack message', async () => {
    // Seed a separate project with copilot gate OFF (copilotEnabled not set on either integration or project)
    const gateOffOrg = await createOrgWithOwner(t.db, { name: 'GateOff', slug: 'gate-off', userId: 'u2' });
    const gateOffProj = await createProject(t.db, gateOffOrg.id, { name: 'Proj', slug: 'proj' });
    const secretsKey = Buffer.alloc(32, 1);
    const ghCiphertext = encryptSecret('ghp_dummy', secretsKey);
    await upsertIntegration(t.db, {
      orgId: gateOffOrg.id,
      provider: 'github',
      mode: 'pat',
      secretCiphertext: ghCiphertext,
      connectedByUserId: 'u2',
      metadata: {},
    });
    const gateOffIntg = await getIntegration(t.db, gateOffOrg.id, 'github');
    await addProjectRepo(t.db, {
      projectId: gateOffProj.id,
      orgIntegrationId: gateOffIntg!.id,
      repoFullName: 'gate-off/web',
      defaultBranch: 'main',
      addedByUserId: 'u2',
    });
    const slackCiphertext = encryptSecret('xoxb-gate-off', secretsKey);
    await upsertIntegration(t.db, {
      orgId: gateOffOrg.id,
      provider: 'slack',
      mode: 'oauth',
      accountLabel: 'GateOff Slack',
      secretCiphertext: slackCiphertext,
      metadata: { teamId: 'T2', botUserId: 'U_BOT2' },
      lastTestOk: true,
    });
    await findOrCreateSlackConversation(t.db, {
      orgId: gateOffOrg.id,
      projectId: gateOffProj.id,
      assistantId: null,
      slackChannelId: 'C2',
      slackThreadTs: '222.2',
    });

    const posted: any[] = [];
    const slackClient: SlackClient = {
      async oauthAccess() { return { ok: false, error: 'x' }; },
      async authTest() { return { ok: false, error: 'x' }; },
      async chatPostMessage(_t, m) { posted.push(m); return { ok: true, ts: '0.0' }; },
      async chatUpdate() { return { ok: true }; },
    };
    const gateOffCtx: ToolCtx = {
      db: t.db,
      orgId: gateOffOrg.id,
      projectId: gateOffProj.id,
      client,
      config: { ...testConfig, SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
      slackClient,
      slackThread: { channel: 'C2', threadTs: '222.2' },
    };

    const res = await callGithubTool(
      gateOffCtx,
      'integration.github.offer_github_issue',
      { repo: 'gate-off/web', title: 'T', body: 'B', summary: 'Raise a fix?' },
    );

    expect(res.isError).toBe(true);
    expect(res.content).toContain('not enabled');
    expect(posted).toHaveLength(0);
  });
});
