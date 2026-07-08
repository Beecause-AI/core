import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner, createProject, createAssistant, getAssistant,
  upsertTeamsIntegration, setTeamsBinding, listConversationMessages, getTeamsConversation,
  setOrgReportsEnabled, setProjectReportsEnabled,
  type TeamsClient, type TeamsAuth, type TeamsSendInput,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { buildTeamsMentionRoute } from '../src/routes/teams-messages.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const config: AppConfig = {
  ...testConfig,
  MICROSOFT_APP_ID: 'app-id-test',
  MICROSOFT_APP_PASSWORD: 'app-secret-test',
  MICROSOFT_APP_TENANT_ID: 'home-tenant-test',
};

// Recording fake TeamsClient.
const sent: Array<{ input: TeamsSendInput }> = [];
const updated: Array<{ input: TeamsSendInput & { activityId: string } }> = [];
let phCounter = 0;
const fakeTeams: TeamsClient = {
  async sendActivity(_auth: TeamsAuth, input: TeamsSendInput) {
    sent.push({ input });
    return { ok: true as const, activityId: `ph-${++phCounter}` };
  },
  async updateActivity(_auth: TeamsAuth, input: TeamsSendInput & { activityId: string }) {
    updated.push({ input });
    return { ok: true as const, activityId: input.activityId };
  },
};

const published: Array<{ laneId: string; turnId: string }> = [];

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let orgId: string;
let orgIntegrationId: string;
let projectId: string;
let assistantId: string;

const TENANT_ID = 'tenant-test-123';
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';
const CONV_ID = 'conv-test-abc';
const BOT_ID = `28:${config.MICROSOFT_APP_ID}`;

/** Build a minimal Teams Activity payload that mentions the bot. */
function makeActivity(opts: {
  id?: string;
  type?: string;
  text?: string;
  tenantId?: string;
  serviceUrl?: string;
  conversationId?: string;
  fromId?: string;
  mentionsBot?: boolean;
}): Record<string, unknown> {
  const {
    id = 'activity-id-1',
    type = 'message',
    text = `<at>Beecause</at> help`,
    tenantId = TENANT_ID,
    serviceUrl = SERVICE_URL,
    conversationId = CONV_ID,
    fromId = 'user-teams-id',
    mentionsBot = true,
  } = opts;
  return {
    type,
    id,
    serviceUrl,
    channelData: { tenant: { id: tenantId } },
    conversation: { id: conversationId, tenantId: tenantId },
    from: { id: fromId },
    text,
    entities: mentionsBot
      ? [{ type: 'mention', mentioned: { id: BOT_ID, name: 'Beecause' }, text: '<at>Beecause</at>' }]
      : [],
  };
}

const postActivity = (payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: '/api/teams/messages',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
    payload: JSON.stringify(payload),
  });

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({
    db: t.db,
    store: t.store,
    config,
    email: fakeEmail().api,
    teamsEventsClient: fakeTeams,
    // auth is always bypassed by the injected authenticate stub
    teamsPublish: async (laneId, turnId) => { published.push({ laneId, turnId }); },
    teamsAuthenticate: async () => true,
  });

  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u-owner' });
  orgId = org.id;

  const conn = await upsertTeamsIntegration(t.db, {
    orgId,
    tenantId: TENANT_ID,
    tenantName: 'Acme Tenant',
    serviceUrl: SERVICE_URL,
    botId: BOT_ID,
    connectedByUserId: 'u-owner',
  });
  orgIntegrationId = conn.id;

  const proj = await createProject(t.db, orgId, { name: 'P', slug: 'p' });
  projectId = proj.id;

  const asst = await createAssistant(t.db, projectId, {
    name: 'Lead',
    persona: 'You are an SRE.',
    model: 'gemini-3-flash-preview',
    isLead: true,
  });
  assistantId = asst.id;
});

afterAll(async () => { await app.close(); await t.stop(); });

// ---------------------------------------------------------------------------
describe('POST /api/teams/messages', () => {
  it('unknown tenant → posts a connect-card attachment, no enqueue', async () => {
    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({ tenantId: 'unknown-tenant-xyz', conversationId: 'conv-unknown' }));
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before); // nothing enqueued
    // The bot sent a connect card
    const newSent = sent.slice(sentBefore);
    expect(newSent.length).toBeGreaterThanOrEqual(1);
    const card = newSent.find((s) => Array.isArray(s.input.attachments) && s.input.attachments.length > 0);
    expect(card).toBeTruthy();
    expect((card!.input.attachments![0] as Record<string, unknown>).contentType).toBe(
      'application/vnd.microsoft.card.adaptive',
    );
  });

  it('non-message activity type → 200, no enqueue, no sendActivity', async () => {
    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({ type: 'conversationUpdate' }));
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before);
    expect(sent.length).toBe(sentBefore);
  });

  it('message with no bot mention → 200, no enqueue', async () => {
    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({ mentionsBot: false }));
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before);
    expect(sent.length).toBe(sentBefore);
  });

  it('known tenant but unbound channel → connect card posted, binding upserted as pending', async () => {
    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({ conversationId: 'conv-unbound' }));
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before); // no enqueue
    const newSent = sent.slice(sentBefore);
    const card = newSent.find((s) => Array.isArray(s.input.attachments) && s.input.attachments.length > 0);
    expect(card).toBeTruthy();
  });

  it('bound channel + orchestrator → user msg appended, placeholder posted, turn enqueued with correct payload', async () => {
    await setTeamsBinding(t.db, {
      orgIntegrationId,
      teamsConversationId: CONV_ID,
      projectId,
      createdByUserId: 'u-owner',
    });

    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({
      id: 'activity-ev1',
      text: `<at>Beecause</at> what is 2+2?`,
    }));
    expect(res.statusCode).toBe(200);

    // placeholder "thinking..." posted
    const newSent = sent.slice(sentBefore);
    expect(newSent.some((s) => s.input.text.includes('thinking'))).toBe(true);

    // turn enqueued
    expect(published.length).toBe(before + 1);

    // user message persisted
    const convo = await getTeamsConversation(t.db, TENANT_ID, CONV_ID);
    expect(convo).toBeTruthy();
    const msgs = await listConversationMessages(t.db, convo!.id);
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'what is 2+2?' });
  });

  it('duplicate activity.id → deduped, handler runs only once', async () => {
    const ev = makeActivity({ id: 'activity-dedup-1', text: `<at>Beecause</at> hey`, conversationId: CONV_ID });
    await postActivity(ev);
    const beforePub = published.length;
    const beforeSent = sent.length;
    await postActivity(ev); // second delivery
    expect(published.length).toBe(beforePub); // NOT re-enqueued
    expect(sent.length).toBe(beforeSent); // NOT re-sent
  });

  it('bound channel with no orchestrator → sends setup prompt, no enqueue', async () => {
    const proj2 = await createProject(t.db, orgId, { name: 'P2', slug: 'p2' });
    const convId2 = 'conv-noorch';
    await setTeamsBinding(t.db, {
      orgIntegrationId,
      teamsConversationId: convId2,
      projectId: proj2.id,
      createdByUserId: 'u-owner',
    });
    const before = published.length;
    const sentBefore = sent.length;
    const res = await postActivity(makeActivity({ id: 'activity-noorch', conversationId: convId2 }));
    expect(res.statusCode).toBe(200);
    expect(published.length).toBe(before); // no enqueue
    const newSent = sent.slice(sentBefore);
    expect(newSent.some((s) => /team|assistant/i.test(s.input.text))).toBe(true);
  });

  it('buildTeamsMentionRoute routes to the teams system agent delegating to orchestrator', async () => {
    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildTeamsMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.systemAgentKey).toBe('teams');
    expect(route.assistantId).toBeNull();
    expect(route.enabledTools).toContain(`agent.${lead.id}`);
    expect(route.messages[0]?.role).toBe('system');
    expect(String(route.messages[0]?.content)).toMatch(/orchestrator/i);
  });

  it('offer_investigation_report injected into enabledTools when the report gate is ON', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, true);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildTeamsMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).toContain('integration.report.offer_investigation_report');
  });

  it('offer_investigation_report NOT injected into enabledTools when the report gate is OFF', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, false);

    const lead = (await getAssistant(t.db, projectId, assistantId))!;
    const route = await buildTeamsMentionRoute(app as any, {
      orgId, projectId, orchestrator: lead,
      history: [{ role: 'user', content: 'prod is down' }],
    });
    expect(route.enabledTools).not.toContain('integration.report.offer_investigation_report');
  });
});
