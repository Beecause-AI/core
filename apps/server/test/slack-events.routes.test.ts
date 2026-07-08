import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, createAssistant, getAssistant, upsertIntegration, getIntegration, encryptSecret, keyFromBase64, setBinding, getBinding, listConversationMessages, getSlackConversation, appendConversationMessage, setIntegrationIssuesEnabled, setProjectIssuesEnabled, setOrgReportsEnabled, setProjectReportsEnabled } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { buildMentionRoute } from '../src/routes/slack-events.js';
import type { AppConfig } from '../src/config.js';
import type { SlackClient } from '@intellilabs/core';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 1).toString('base64'),
  SLACK_SIGNING_SECRET: 'sign-secret-123',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

const posted: Array<{ channel: string; text: string; threadTs?: string; blocks?: any[] }> = [];
const updated: Array<{ channel: string; ts: string; text: string }> = [];
let phCounter = 0;
const fakeSlack: SlackClient = {
  async oauthAccess() { return { ok: false, error: 'x' }; },
  async authTest() { return { ok: false, error: 'x' }; },
  async chatPostMessage(_t, m) { posted.push({ channel: m.channel, text: m.text, threadTs: m.threadTs, blocks: m.blocks as any[] | undefined }); return { ok: true, ts: `ph.${++phCounter}` }; },
  async chatUpdate(_t, u) { updated.push(u); return { ok: true }; },
};
const published: Array<{ laneId: string; turnId: string }> = [];

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let orgId: string, orgIntegrationId: string, projectId: string, assistantId: string;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({ db: t.db, store: t.store, config, email: fakeEmail().api,
    slackEventsClient: fakeSlack, slackPublish: async (laneId, turnId) => { published.push({ laneId, turnId }); } });
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;
  await upsertIntegration(t.db, {
    orgId, provider: 'slack', mode: 'oauth', accountLabel: 'Acme HQ',
    secretCiphertext: encryptSecret('xoxb-test', keyFromBase64(config.SECRETS_KEY!)),
    metadata: { teamId: 'T1', botUserId: 'U_BOT' }, lastTestOk: true,
  });
  orgIntegrationId = (await getIntegration(t.db, orgId, 'slack'))!.id;
  // Seed a GitHub integration (needed for the copilot gate tests).
  await upsertIntegration(t.db, { orgId, provider: 'github', mode: 'pat', connectedByUserId: 'u-owner', metadata: {} });
  const proj = await createProject(t.db, orgId, { name: 'P', slug: 'p' });
  projectId = proj.id;
  // The project's orchestrator (single is_lead assistant) — the Slack system agent delegates to it.
  const asst = await createAssistant(t.db, projectId, { name: 'A', persona: 'You are helpful.', model: 'gemini-3-flash-preview', isLead: true });
  assistantId = asst.id;
});
afterAll(async () => { await app.close(); await t.stop(); });

const sign = (ts: string, body: string) => 'v0=' + createHmac('sha256', config.SLACK_SIGNING_SECRET!).update(`v0:${ts}:${body}`).digest('hex');
const postEvent = (payload: object, signed = true) => {
  const body = JSON.stringify(payload);
  const ts = String(Math.floor(Date.now() / 1000));
  return app.inject({ method: 'POST', url: '/api/slack/events',
    headers: { 'x-slack-request-timestamp': ts, 'x-slack-signature': signed ? sign(ts, body) : 'v0=bad', 'content-type': 'application/json' },
    payload: body });
};

describe('POST /api/slack/events', () => {
  it('answers the url_verification challenge', async () => {
    const res = await postEvent({ type: 'url_verification', challenge: 'abc' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ challenge: 'abc' });
  });

  it('rejects a bad signature (401)', async () => {
    const res = await postEvent({ type: 'event_callback', team_id: 'T1', event: { type: 'app_mention' } }, false);
    expect(res.statusCode).toBe(401);
  });

  it('unbound channel → 200, pending binding, posts a hint, no enqueue', async () => {
    const before = published.length;
    const res = await postEvent({ type: 'event_callback', event_id: 'Ev0', team_id: 'T1', event: { type: 'app_mention', channel: 'C_NEW', user: 'U1', text: '<@U_BOT> hi', ts: '10.1' } });
    expect(res.statusCode).toBe(200);
    const msg = posted.find((p) => p.channel === 'C_NEW');
    expect(msg).toBeTruthy();
    // a button that deep-links to the connect page for this team + channel
    const button = msg!.blocks?.flatMap((b: any) => b.elements ?? []).find((e: any) => e.type === 'button');
    expect(button?.url).toContain('/slack/connect?team=T1&channel=C_NEW');
    expect(button?.url).toContain('acme.'); // workspace-host deep link (org slug 'acme')
    expect(published.length).toBe(before);
    expect((await getBinding(t.db, orgIntegrationId, 'C_NEW'))?.status).toBe('pending');
  });

  it('bound channel → conversation + user message + placeholder + enqueue', async () => {
    await setBinding(t.db, { orgIntegrationId, slackChannelId: 'C_OK', projectId, createdByUserId: 'u-owner' });
    const before = published.length;
    const res = await postEvent({ type: 'event_callback', event_id: 'Ev1', team_id: 'T1', event: { type: 'app_mention', channel: 'C_OK', user: 'U1', text: '<@U_BOT> what is 2+2', ts: '20.1' } });
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before + 1);
    expect(posted.some((p) => p.channel === 'C_OK' && p.text.includes('thinking'))).toBe(true);
    const convo = await getSlackConversation(t.db, 'C_OK', '20.1');
    const msgs = await listConversationMessages(t.db, convo!.id);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'what is 2+2' });
  });

  it('dedupes a redelivered event_id', async () => {
    const ev = { type: 'event_callback', event_id: 'Ev2', team_id: 'T1', event: { type: 'app_mention', channel: 'C_OK', user: 'U1', text: '<@U_BOT> hey', ts: '30.1' } };
    await postEvent(ev); const before = published.length;
    await postEvent(ev);
    expect(published.length).toBe(before);
  });

  it('ignores a bot-authored event (200, no enqueue)', async () => {
    const before = published.length;
    const res = await postEvent({ type: 'event_callback', event_id: 'Ev3', team_id: 'T1', event: { type: 'app_mention', channel: 'C_OK', bot_id: 'B1', text: 'x', ts: '40.1' } });
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before);
  });

  it('unknown team → 401', async () => {
    const res = await postEvent({ type: 'event_callback', team_id: 'T_UNKNOWN', event: { type: 'app_mention' } });
    expect(res.statusCode).toBe(401);
  });

  it('routes to the slack system agent that delegates to the project orchestrator', async () => {
    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.systemAgentKey).toBe('slack');
    expect(route.assistantId).toBeNull();
    expect(route.model).toBe('gemini-3-flash-preview');
    expect(route.enabledTools).toContain(`agent.${lead.id}`);
    // The Slack agent no longer posts via tools — its response is auto-delivered to the thread.
    expect(route.enabledTools).not.toContain('integration.slack.reply_in_thread');
    expect(route.enabledTools).not.toContain('integration.slack.post_message');
    // system persona leads the assembled prompt
    expect(route.messages[0]?.role).toBe('system');
    expect(String(route.messages[0]?.content)).toMatch(/orchestrator/i);
  });

  it('bound channel whose project has no orchestrator → prompts to set up a team, no enqueue', async () => {
    const proj2 = await createProject(t.db, orgId, { name: 'P2', slug: 'p2' });
    await setBinding(t.db, { orgIntegrationId, slackChannelId: 'C_NOORCH', projectId: proj2.id, createdByUserId: 'u-owner' });
    const before = published.length;
    const res = await postEvent({ type: 'event_callback', event_id: 'EvNoOrch', team_id: 'T1', event: { type: 'app_mention', channel: 'C_NOORCH', user: 'U1', text: '<@U_BOT> help', ts: '60.1' } });
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before); // not enqueued — nothing to delegate to
    const msg = posted.find((p) => p.channel === 'C_NOORCH');
    expect(msg?.text).toMatch(/incident response team/i);
  });

  it('second mention in the same thread replays prior history into the enqueued payload', async () => {
    // bind a fresh channel
    await setBinding(t.db, { orgIntegrationId, slackChannelId: 'C_MEM', projectId, createdByUserId: 'u-owner' });

    // 1st mention (thread root ts = 50.1)
    await postEvent({ type: 'event_callback', event_id: 'Mem1', team_id: 'T1', event: { type: 'app_mention', channel: 'C_MEM', user: 'U1', text: '<@U_BOT> first question', ts: '50.1' } });
    const convo = await getSlackConversation(t.db, 'C_MEM', '50.1');
    expect(convo).toBeTruthy();

    // simulate the assistant's reply being persisted (the engine-worker does this in prod)
    await appendConversationMessage(t.db, { conversationId: convo!.id, role: 'assistant', content: 'first answer' });

    // 2nd mention in the SAME thread (thread_ts = 50.1)
    await postEvent({ type: 'event_callback', event_id: 'Mem2', team_id: 'T1', event: { type: 'app_mention', channel: 'C_MEM', user: 'U1', text: '<@U_BOT> follow up', thread_ts: '50.1', ts: '50.2' } });

    // the transcript now has: user "first question", assistant "first answer", user "follow up"
    const msgs = await listConversationMessages(t.db, convo!.id);
    expect(msgs.map((m) => [m.role, m.content])).toEqual([
      ['user', 'first question'],
      ['assistant', 'first answer'],
      ['user', 'follow up'],
    ]);
  });

  it('offer_github_issue injected into enabledTools when the issue-creation gate is ON', async () => {
    // Turn gate fully ON: github issuesEnabled + project issuesEnabled
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', true);
    await setProjectIssuesEnabled(t.db, orgId, projectId, true);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).toContain('integration.github.offer_github_issue');
    // The skill block should also be present in the messages
    const hasSkillBlock = route.messages.some((m) => m.content.includes('Raising a fix issue'));
    expect(hasSkillBlock).toBe(true);
  });

  it('offer_github_issue NOT injected into enabledTools when the issue-creation gate is OFF', async () => {
    // Turn gate OFF: github issuesEnabled=true but project issuesEnabled=false
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', true);
    await setProjectIssuesEnabled(t.db, orgId, projectId, false);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).not.toContain('integration.github.offer_github_issue');
    const hasSkillBlock = route.messages.some((m) => m.content.includes('Raising a fix issue'));
    expect(hasSkillBlock).toBe(false);
  });

  it('offer_investigation_report injected into enabledTools when the report gate is ON', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, true);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).toContain('integration.report.offer_investigation_report');
  });

  it('offer_investigation_report NOT injected into enabledTools when the report gate is OFF', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, false);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).not.toContain('integration.report.offer_investigation_report');
  });
});
