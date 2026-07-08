import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner, upsertIntegration, encryptSecret, keyFromBase64,
  createAgentRun, getAgentRun, listLaneQueue,
  createCopilotIssueOffer, getCopilotIssueOffer, ensureDefaultProject, createProject,
  setIntegrationIssuesEnabled, setProjectIssuesEnabled,
  type GithubClient,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import type { SlackClient } from '@intellilabs/core';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 2).toString('base64'),
  SLACK_SIGNING_SECRET: 'sign-secret-interactions',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

const updated: Array<{ channel: string; ts: string; text: string }> = [];
const fakeSlack: SlackClient = {
  async oauthAccess() { return { ok: false, error: 'x' }; },
  async authTest() { return { ok: false, error: 'x' }; },
  async chatPostMessage() { return { ok: true, ts: 'ph.1' }; },
  async chatUpdate(_t, u) { updated.push(u); return { ok: true }; },
};

const published: Array<{ laneId: string; turnId: string }> = [];

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let orgId: string;
let laneId: string;
let agentRunId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({
    db: t.db, store: t.store, config, email: fakeEmail().api,
    slackEventsClient: fakeSlack,
    slackPublish: async (l, tid) => { published.push({ laneId: l, turnId: tid }); },
  });

  const org = await createOrgWithOwner(t.db, { name: 'OrgI', slug: 'orgi', userId: 'u-owner-i' });
  orgId = org.id;

  // Create a slack integration for team T1
  await upsertIntegration(t.db, {
    orgId, provider: 'slack', mode: 'oauth', accountLabel: 'OrgI HQ',
    secretCiphertext: encryptSecret('xoxb-test-i', keyFromBase64(config.SECRETS_KEY!)),
    metadata: { teamId: 'T1', botUserId: 'U_BOT_I' }, lastTestOk: true,
  });

  // Use a fixed UUID as the lane id (agent_runs.laneId is a plain UUID; no FK table)
  laneId = '00000000-0000-0000-0000-000000000001';

  // Create a suspended agent run
  const run = await createAgentRun(t.db, {
    turnId: '00000000-0000-0000-0000-000000000099',
    laneId,
    orgId,
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'mcp.write', arguments: {} }] },
    ],
    pendingCalls: [{ id: 'w1', name: 'mcp.write', arguments: {} }],
    model: 'm',
    enabledTools: ['mcp.write'],
    slack: { channel: 'C', threadTs: '1', placeholderTs: 'p' },
  });
  agentRunId = run.id;
});

afterAll(async () => { await app.close(); await t.stop(); });

/** Build a properly-signed urlencoded payload for Slack interactions. */
const sign = (ts: string, body: string) =>
  'v0=' + createHmac('sha256', config.SLACK_SIGNING_SECRET!).update(`v0:${ts}:${body}`).digest('hex');

function postInteraction(payloadObj: object, signed = true) {
  const payloadStr = JSON.stringify(payloadObj);
  const body = `payload=${encodeURIComponent(payloadStr)}`;
  const ts = String(Math.floor(Date.now() / 1000));
  return app.inject({
    method: 'POST',
    url: '/api/slack/interactions',
    headers: {
      'x-slack-request-timestamp': ts,
      'x-slack-signature': signed ? sign(ts, body) : 'v0=bad',
      'content-type': 'application/x-www-form-urlencoded',
    },
    payload: body,
  });
}

describe('POST /api/slack/interactions', () => {
  it('approve: resumes the agent turn and marks run approved', async () => {
    const beforePublished = published.length;

    const res = await postInteraction({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'agent_approve', value: `${agentRunId}:approve` }],
    });

    expect(res.statusCode).toBe(200);

    // Published to the right lane
    const pub = published.slice(beforePublished);
    expect(pub).toHaveLength(1);
    expect(pub[0]!.laneId).toBe(laneId);

    // Query the message queue for queued resume turns in the lane
    const turns = (await listLaneQueue(t.db, laneId)).filter((r) => r.status === 'queued');

    expect(turns.length).toBeGreaterThanOrEqual(1);
    const resumeTurn = turns.find((row) => {
      const p = row.payload as any;
      return p.resume === true && p.agentRunId === agentRunId;
    });
    expect(resumeTurn).toBeTruthy();
    const p = resumeTurn!.payload as any;
    expect(p.decision).toBe('approved');
    expect(p.model).toBe('m');
    expect(p.enabledTools).toEqual(['mcp.write']);
    expect(p.slack).toEqual({ channel: 'C', threadTs: '1', placeholderTs: 'p' });
    expect(p.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', toolCalls: [{ id: 'w1', name: 'mcp.write', arguments: {} }] },
    ]);

    // turnId published matches the queued turn's id
    expect(pub[0]!.turnId).toBe(resumeTurn!.id);

    // Agent run updated
    const updatedRun = await getAgentRun(t.db, agentRunId);
    expect(updatedRun?.status).toBe('approved');
    expect(updatedRun?.approvedBy).toBe('U1');
  });

  it('deny: resumes with decision=denied and marks run denied', async () => {
    // Create a fresh suspended run for the deny test
    const denyLaneId = '00000000-0000-0000-0000-000000000002';
    const denyRun = await createAgentRun(t.db, {
      turnId: '00000000-0000-0000-0000-000000000100',
      laneId: denyLaneId,
      orgId,
      messages: [{ role: 'user', content: 'deny me' }],
      pendingCalls: [{ id: 'w2', name: 'mcp.delete', arguments: {} }],
      model: 'm2',
      enabledTools: ['mcp.delete'],
      slack: { channel: 'C2', threadTs: '2', placeholderTs: 'p2' },
    });

    const beforePublished = published.length;

    const res = await postInteraction({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U2' },
      actions: [{ action_id: 'agent_deny', value: `${denyRun.id}:deny` }],
    });

    expect(res.statusCode).toBe(200);

    const pub = published.slice(beforePublished);
    expect(pub).toHaveLength(1);
    expect(pub[0]!.laneId).toBe(denyLaneId);

    const turns = (await listLaneQueue(t.db, denyLaneId)).filter((r) => r.status === 'queued');

    const resumeTurn = turns.find((row) => {
      const p = row.payload as any;
      return p.resume === true && p.agentRunId === denyRun.id;
    });
    expect(resumeTurn).toBeTruthy();
    expect((resumeTurn!.payload as any).decision).toBe('denied');

    const updatedRun = await getAgentRun(t.db, denyRun.id);
    expect(updatedRun?.status).toBe('denied');
    expect(updatedRun?.approvedBy).toBe('U2');
  });

  it('bad signature → 401, no enqueue', async () => {
    const beforePublished = published.length;
    const res = await postInteraction({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'agent_approve', value: `${agentRunId}:approve` }],
    }, false);

    expect(res.statusCode).toBe(401);
    expect(published.length).toBe(beforePublished);
  });

  it('already-resolved run → 200 no-op, no new enqueue', async () => {
    // The run from the first approve test is now status='approved'
    const beforePublished = published.length;

    const res = await postInteraction({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'agent_approve', value: `${agentRunId}:approve` }],
    });

    expect(res.statusCode).toBe(200);
    // No new publish — idempotent no-op
    expect(published.length).toBe(beforePublished);
  });

  it('double-click approve: second request is a 200 no-op — exactly one resume turn enqueued', async () => {
    // Create a fresh suspended run so the first-approve test does not interfere
    const dcLaneId = '00000000-0000-0000-0000-000000000003';
    const dcRun = await createAgentRun(t.db, {
      turnId: '00000000-0000-0000-0000-000000000101',
      laneId: dcLaneId,
      orgId,
      messages: [{ role: 'user', content: 'double click me' }],
      pendingCalls: [{ id: 'w3', name: 'mcp.write', arguments: {} }],
      model: 'm',
      enabledTools: ['mcp.write'],
      slack: { channel: 'C3', threadTs: '3', placeholderTs: 'p3' },
    });

    const beforePublished = published.length;
    const payload = {
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U3' },
      actions: [{ action_id: 'agent_approve', value: `${dcRun.id}:approve` }],
    };

    // Simulate two fast Approve clicks
    const [res1, res2] = await Promise.all([
      postInteraction(payload),
      postInteraction(payload),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Exactly ONE publish must have occurred
    const newPublished = published.slice(beforePublished);
    expect(newPublished).toHaveLength(1);
    expect(newPublished[0]!.laneId).toBe(dcLaneId);

    // Exactly one resume turn for this run in the queue
    const turns = (await listLaneQueue(t.db, dcLaneId)).filter((r) => r.status === 'queued');
    const resumeTurns = turns.filter((row) => {
      const p = row.payload as any;
      return p.resume === true && p.agentRunId === dcRun.id;
    });
    expect(resumeTurns).toHaveLength(1);

    // Run ends up approved (the winner's decision)
    const finalRun = await getAgentRun(t.db, dcRun.id);
    expect(finalRun!.status).toBe('approved');
    expect(finalRun!.approvedBy).toBe('U3');
  });

  it('unknown run id → 200 no-op, no enqueue', async () => {
    const beforePublished = published.length;
    const unknownId = '00000000-0000-0000-0000-deadbeef0000';

    const res = await postInteraction({
      type: 'block_actions',
      team: { id: 'T1' },
      user: { id: 'U1' },
      actions: [{ action_id: 'agent_approve', value: `${unknownId}:approve` }],
    });

    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(beforePublished);
  });
});

// ── Copilot issue offer tests ─────────────────────────────────────────────────

const copilotConfig: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 3).toString('base64'),
  SLACK_SIGNING_SECRET: 'sign-secret-copilot',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

describe('POST /api/slack/interactions — copilot issue offers', () => {
  let ct: Awaited<ReturnType<typeof startTestDb>>;
  let cApp: FastifyInstance;
  let cOrgId: string;
  let cProjectId: string;

  const chatUpdated: Array<{ channel: string; ts: string; text: string }> = [];
  const fakeCopilotSlack: SlackClient = {
    async oauthAccess() { return { ok: false, error: 'x' }; },
    async authTest() { return { ok: false, error: 'x' }; },
    async chatPostMessage() { return { ok: true, ts: 'ph.1' }; },
    async chatUpdate(_t, u) { chatUpdated.push(u); return { ok: true }; },
  };

  // Counters for createIssue calls (to verify double-click guard)
  let createIssueCallCount = 0;
  let lastIssueBody = '';

  const fakeCopilotGithub: GithubClient = {
    async probePat() { return { ok: false }; },
    async probeApp() { return { ok: false }; },
    async listRepos() { return []; },
    async listReposDetailed() { return { repos: [], nextPage: null }; },
    async installationAccount() { return null; },
    async getFile() { throw new Error('not implemented'); },
    async listDirectory() { return []; },
    async getRefInfo() { throw new Error('not implemented'); },
    async searchCode() { return []; },
    async searchIssues() { return []; },
    async getIssue() { throw new Error('not implemented'); },
    async createIssue(_creds, _repo, _title, body) {
      createIssueCallCount++;
      lastIssueBody = body;
      return { number: 5, url: 'https://github.com/acme/api/issues/5', nodeId: 'node_abc' };
    },
    async listPullRequests() { return []; },
    async getPullRequest() { throw new Error('not implemented'); },
    async listCommits() { return []; },
    async getCommit() { throw new Error('not implemented'); },
    async listTree() { return { truncated: false, entries: [] }; },
  };

  beforeAll(async () => {
    ct = await startTestDb();
    cApp = await buildApp({
      db: ct.db, store: ct.store, config: copilotConfig, email: fakeEmail().api,
      slackEventsClient: fakeCopilotSlack,
      githubClient: fakeCopilotGithub,
      slackPublish: async () => {},
    });

    const org = await createOrgWithOwner(ct.db, { name: 'CopilotOrg', slug: 'copilotorg', userId: 'u-owner-c' });
    cOrgId = org.id;

    // Slack integration for team TC1
    await upsertIntegration(ct.db, {
      orgId: cOrgId, provider: 'slack', mode: 'oauth', accountLabel: 'CopilotOrg Slack',
      secretCiphertext: encryptSecret('xoxb-copilot-slack', keyFromBase64(copilotConfig.SECRETS_KEY!)),
      metadata: { teamId: 'TC1', botUserId: 'U_BOT_C' }, lastTestOk: true,
    });

    // GitHub integration — needed so credsForRow can resolve it
    await upsertIntegration(ct.db, {
      orgId: cOrgId, provider: 'github', mode: 'pat', accountLabel: 'CopilotOrg GH',
      secretCiphertext: encryptSecret('ghp_faketoken', keyFromBase64(copilotConfig.SECRETS_KEY!)),
      metadata: {}, lastTestOk: true,
    });

    // Default project for this org
    const proj = await ensureDefaultProject(ct.db, cOrgId);
    cProjectId = proj.id;

    // Copilot flags enabled by default. (Server-to-server Copilot assignment was REMOVED — GitHub
    // blocks it and the coding agent failed to start — so the create flow only creates the issue,
    // regardless of the copilot flags.)
    await setIntegrationIssuesEnabled(ct.db, cOrgId, 'github', true);
    await setProjectIssuesEnabled(ct.db, cOrgId, cProjectId, true);
  });

  afterAll(async () => { await cApp.close(); await ct.stop(); });

  const csign = (ts: string, body: string) =>
    'v0=' + createHmac('sha256', copilotConfig.SLACK_SIGNING_SECRET!).update(`v0:${ts}:${body}`).digest('hex');

  function postCopilotInteraction(payloadObj: object) {
    const payloadStr = JSON.stringify(payloadObj);
    const body = `payload=${encodeURIComponent(payloadStr)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    return cApp.inject({
      method: 'POST',
      url: '/api/slack/interactions',
      headers: {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': csign(ts, body),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: body,
    });
  }

  it('create with fixed repo → offer created, issueNumber=5, NOT assigned to Copilot (API assignment dropped), chatUpdate has link', async () => {
    const offer = await createCopilotIssueOffer(ct.db, {
      provider: 'github', orgId: cOrgId, projectId: cProjectId, conversationId: 'conv-1',
      slackChannelId: 'C_COP', slackThreadTs: '1.1',
      repo: 'acme/api', candidateRepos: [],
      title: 'Fix the bug', body: 'Details here', summary: 'Fix the bug summary',
    });
    // Set a message ts so editMessage fires
    await ct.db.collection('copilot_issue_offers').doc(offer.id).update({ slackMessageTs: 'msg.100' });

    const beforeUpdated = chatUpdated.length;    const res = await postCopilotInteraction({
      type: 'block_actions',
      team: { id: 'TC1' },
      user: { id: 'UC1' },
      actions: [{ action_id: 'copilot_issue_create', value: `${offer.id}:create` }],
    });

    expect(res.statusCode).toBe(200);

    const updated = await getCopilotIssueOffer(ct.db, offer.id);
    expect(updated?.status).toBe('created');
    expect(updated?.issueNumber).toBe(5);
    expect(updated?.issueUrl).toBe('https://github.com/acme/api/issues/5');
    expect(updated?.copilotAssigned).toBe(false);
    expect(updated?.error ?? null).toBe(null);

    const msgs = chatUpdated.slice(beforeUpdated);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toContain('https://github.com/acme/api/issues/5');
    expect(msgs[0]!.text).not.toContain('assigned to Copilot');
    expect(msgs[0]!.text).not.toContain("Couldn't assign Copilot");

    // Issue body ends with a markdown link to the conversation on the tenant subdomain.
    expect(lastIssueBody).toContain('https://copilotorg.beecause.ai/p/');
    expect(lastIssueBody).toContain('/conversations/conv-1');
    expect(lastIssueBody).toContain('](https://copilotorg.beecause.ai/p/');
  });

  it('issues on but copilot off → issue created, NOT assigned, plain message', async () => {
    // Dedicated project with issue creation on but Copilot hand-off off.
    const proj = await createProject(ct.db, cOrgId, { name: 'IssuesOnly', slug: 'issues-only' });
    await setProjectIssuesEnabled(ct.db, cOrgId, proj.id, true); // copilot stays off (default)

    const offer = await createCopilotIssueOffer(ct.db, {
      provider: 'github', orgId: cOrgId, projectId: proj.id, conversationId: 'conv-2',
      slackChannelId: 'C_COP', slackThreadTs: '2.1',
      repo: 'acme/api', candidateRepos: [],
      title: 'Plain issue', body: 'Body', summary: 'Plain summary',
    });
    await ct.db.collection('copilot_issue_offers').doc(offer.id).update({ slackMessageTs: 'msg.200' });

    const beforeUpdated = chatUpdated.length;    const res = await postCopilotInteraction({
      type: 'block_actions',
      team: { id: 'TC1' },
      user: { id: 'UC1' },
      actions: [{ action_id: 'copilot_issue_create', value: `${offer.id}:create` }],
    });
    expect(res.statusCode).toBe(200);

    const updated = await getCopilotIssueOffer(ct.db, offer.id);
    expect(updated?.status).toBe('created');
    expect(updated?.copilotAssigned).toBe(false);
    expect(updated?.error ?? null).toBe(null); // not a failure — Copilot simply wasn't requested

    const msgs = chatUpdated.slice(beforeUpdated);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toContain('Issue #5 created');
    expect(msgs[0]!.text).not.toContain('assigned to Copilot');
    expect(msgs[0]!.text).not.toContain("Couldn't assign Copilot");
  });

  it('dismiss → offer declined, chatUpdate says "Dismissed"', async () => {
    const offer = await createCopilotIssueOffer(ct.db, {
      provider: 'github', orgId: cOrgId, projectId: cProjectId, conversationId: 'conv-3',
      slackChannelId: 'C_COP', slackThreadTs: '1.3',
      repo: 'acme/api', candidateRepos: [],
      title: 'Dismiss me', body: 'Body', summary: 'Summary',
    });
    await ct.db.collection('copilot_issue_offers').doc(offer.id).update({ slackMessageTs: 'msg.300' });

    const beforeUpdated = chatUpdated.length;
    const res = await postCopilotInteraction({
      type: 'block_actions',
      team: { id: 'TC1' },
      user: { id: 'UC3' },
      actions: [{ action_id: 'copilot_issue_dismiss', value: `${offer.id}:dismiss` }],
    });

    expect(res.statusCode).toBe(200);

    const updated = await getCopilotIssueOffer(ct.db, offer.id);
    expect(updated?.status).toBe('declined');

    const msgs = chatUpdated.slice(beforeUpdated);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toContain('Dismissed');
  });

  it('double-click create → exactly ONE issue created (claim guard)', async () => {
    const offer = await createCopilotIssueOffer(ct.db, {
      provider: 'github', orgId: cOrgId, projectId: cProjectId, conversationId: 'conv-4',
      slackChannelId: 'C_COP', slackThreadTs: '1.4',
      repo: 'acme/api', candidateRepos: [],
      title: 'Double click', body: 'Body', summary: 'Summary',
    });
    await ct.db.collection('copilot_issue_offers').doc(offer.id).update({ slackMessageTs: 'msg.400' });

    const beforeCreateCount = createIssueCallCount;
    const payload = {
      type: 'block_actions',
      team: { id: 'TC1' },
      user: { id: 'UC4' },
      actions: [{ action_id: 'copilot_issue_create', value: `${offer.id}:create` }],
    };

    const [res1, res2] = await Promise.all([
      postCopilotInteraction(payload),
      postCopilotInteraction(payload),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // createIssue must have been called exactly once
    expect(createIssueCallCount - beforeCreateCount).toBe(1);

    const updated = await getCopilotIssueOffer(ct.db, offer.id);
    expect(updated?.status).toBe('created');
  });

  it('copilot_issue_repo_select action → 200 no-op, offer status unchanged', async () => {
    const offer = await createCopilotIssueOffer(ct.db, {
      provider: 'github', orgId: cOrgId, projectId: cProjectId, conversationId: 'conv-5',
      slackChannelId: 'C_COP', slackThreadTs: '1.5',
      repo: null, candidateRepos: ['acme/api', 'acme/web'],
      title: 'Select repo', body: 'Body', summary: 'Summary',
    });

    const res = await postCopilotInteraction({
      type: 'block_actions',
      team: { id: 'TC1' },
      user: { id: 'UC5' },
      actions: [{ action_id: 'copilot_issue_repo_select', value: `${offer.id}:select` }],
      state: { values: { copilot_issue_repo: { copilot_issue_repo_select: { selected_option: { value: 'acme/api' } } } } },
    });

    expect(res.statusCode).toBe(200);

    // Offer unchanged (still offered)
    const updated = await getCopilotIssueOffer(ct.db, offer.id);
    expect(updated?.status).toBe('offered');
  });
});
