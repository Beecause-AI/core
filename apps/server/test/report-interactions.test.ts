import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner, upsertIntegration, encryptSecret, keyFromBase64,
  createReportOffer, getReportOffer,
} from '@intellilabs/core';
import type { SlackClient, ReportGenPublisher, ReportGenJob } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { startTestDb, testConfig, fakeEmail } from './helpers.js';

const config: AppConfig = {
  ...testConfig,
  SECRETS_KEY: Buffer.alloc(32, 7).toString('base64'),
  SLACK_SIGNING_SECRET: 'sign-secret-report',
  INTEGRATION_STATE_SECRET: 'k'.repeat(40),
};

describe('POST /api/slack/interactions — report offer', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let app: FastifyInstance;
  let orgId: string;

  const chatUpdated: Array<{ channel: string; ts: string; text: string }> = [];
  const fakeReportSlack: SlackClient = {
    async oauthAccess() { return { ok: false, error: 'x' }; },
    async authTest() { return { ok: false, error: 'x' }; },
    async chatPostMessage() { return { ok: true, ts: 'ph.1' }; },
    async chatUpdate(_t, u) { chatUpdated.push(u); return { ok: true }; },
  };

  const publishedJobs: ReportGenJob[] = [];
  const fakeReportGenPublisher: ReportGenPublisher = {
    async publish(job) { publishedJobs.push(job); },
  };

  beforeAll(async () => {
    t = await startTestDb();
    app = await buildApp({
      db: t.db, store: t.store, config, email: fakeEmail().api,
      slackEventsClient: fakeReportSlack,
      slackPublish: async () => {},
      reportGenPublisher: fakeReportGenPublisher,
    });

    const org = await createOrgWithOwner(t.db, { name: 'ReportOrg', slug: 'reportorg', userId: 'u-owner-r' });
    orgId = org.id;

    // Slack integration for team TR1
    await upsertIntegration(t.db, {
      orgId, provider: 'slack', mode: 'oauth', accountLabel: 'ReportOrg Slack',
      secretCiphertext: encryptSecret('xoxb-report-slack', keyFromBase64(config.SECRETS_KEY!)),
      metadata: { teamId: 'TR1', botUserId: 'U_BOT_R' }, lastTestOk: true,
    });
  });

  afterAll(async () => { await app.close(); await t.stop(); });

  const rsign = (ts: string, body: string) =>
    'v0=' + createHmac('sha256', config.SLACK_SIGNING_SECRET!).update(`v0:${ts}:${body}`).digest('hex');

  function postReportInteraction(payloadObj: object) {
    const payloadStr = JSON.stringify(payloadObj);
    const body = `payload=${encodeURIComponent(payloadStr)}`;
    const ts = String(Math.floor(Date.now() / 1000));
    return app.inject({
      method: 'POST',
      url: '/api/slack/interactions',
      headers: {
        'x-slack-request-timestamp': ts,
        'x-slack-signature': rsign(ts, body),
        'content-type': 'application/x-www-form-urlencoded',
      },
      payload: body,
    });
  }

  it('generate: claims offer, enqueues job, updates slack message', async () => {
    const offer = await createReportOffer(t.db, {
      orgId, projectId: 'proj-r1', conversationId: 'conv-r1',
      slackChannelId: 'C_REP', slackThreadTs: '1.1',
    });
    // Set slackMessageTs so chatUpdate fires
    await t.db.collection('report_offers').doc(offer.id).update({ slackMessageTs: 'msg.r1' });

    const beforeUpdated = chatUpdated.length;
    const beforePublished = publishedJobs.length;

    const res = await postReportInteraction({
      type: 'block_actions',
      team: { id: 'TR1' },
      user: { id: 'UR1' },
      actions: [{ action_id: `report_offer:${offer.id}:generate` }],
    });

    expect(res.statusCode).toBe(200);

    // Offer status is now generating
    const updated = await getReportOffer(t.db, offer.id);
    expect(updated?.status).toBe('generating');

    // Exactly one job published with the correct offerId
    const newJobs = publishedJobs.slice(beforePublished);
    expect(newJobs).toHaveLength(1);
    expect(newJobs[0]!.offerId).toBe(offer.id);

    // Slack message updated to indicate generation started
    const msgs = chatUpdated.slice(beforeUpdated);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toMatch(/generating report/i);
  });

  it('generate (double-click): second click is a no-op — exactly one job published', async () => {
    const offer = await createReportOffer(t.db, {
      orgId, projectId: 'proj-r2', conversationId: 'conv-r2',
      slackChannelId: 'C_REP', slackThreadTs: '2.1',
    });
    await t.db.collection('report_offers').doc(offer.id).update({ slackMessageTs: 'msg.r2' });

    const beforePublished = publishedJobs.length;
    const payload = {
      type: 'block_actions',
      team: { id: 'TR1' },
      user: { id: 'UR2' },
      actions: [{ action_id: `report_offer:${offer.id}:generate` }],
    };

    // Simulate two fast Generate clicks
    const [res1, res2] = await Promise.all([
      postReportInteraction(payload),
      postReportInteraction(payload),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    // Exactly one job published (claim guard prevents double enqueue)
    const newJobs = publishedJobs.slice(beforePublished);
    expect(newJobs).toHaveLength(1);
    expect(newJobs[0]!.offerId).toBe(offer.id);

    const updated = await getReportOffer(t.db, offer.id);
    expect(updated?.status).toBe('generating');
  });

  it('decline: marks offer declined, updates slack message, no job published', async () => {
    const offer = await createReportOffer(t.db, {
      orgId, projectId: 'proj-r3', conversationId: 'conv-r3',
      slackChannelId: 'C_REP', slackThreadTs: '3.1',
    });
    await t.db.collection('report_offers').doc(offer.id).update({ slackMessageTs: 'msg.r3' });

    const beforeUpdated = chatUpdated.length;
    const beforePublished = publishedJobs.length;

    const res = await postReportInteraction({
      type: 'block_actions',
      team: { id: 'TR1' },
      user: { id: 'UR3' },
      actions: [{ action_id: `report_offer:${offer.id}:decline` }],
    });

    expect(res.statusCode).toBe(200);

    // Offer declined
    const updated = await getReportOffer(t.db, offer.id);
    expect(updated?.status).toBe('declined');

    // No job published
    expect(publishedJobs.length).toBe(beforePublished);

    // Slack message updated to indicate dismissal
    const msgs = chatUpdated.slice(beforeUpdated);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.text).toMatch(/dismissed/i);
  });

  it('unknown offer id → 200 no-op, no job published', async () => {
    const beforePublished = publishedJobs.length;
    const unknownId = '00000000-0000-0000-0000-deadbeef1234';

    const res = await postReportInteraction({
      type: 'block_actions',
      team: { id: 'TR1' },
      user: { id: 'UR4' },
      actions: [{ action_id: `report_offer:${unknownId}:generate` }],
    });

    expect(res.statusCode).toBe(200);
    expect(publishedJobs.length).toBe(beforePublished);
  });
});
