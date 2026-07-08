import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  setOrgReportsEnabled,
  setProjectReportsEnabled,
  getUnpostedReportOfferForConversation,
  findOrCreateSlackConversation,
} from '@intellilabs/core';
import type { Db } from '@intellilabs/core';
import { offerInvestigationReport, type ReportToolCtx } from '../src/integrations/report/offer-investigation-report.js';
import { startTestDb } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;
let db: Db;
let orgId: string;
let projectId: string;
let conversationId: string;

const CHANNEL = 'RC1';
const THREAD_TS = '333.3';

beforeAll(async () => {
  t = await startTestDb();
  db = t.db;

  const org = await createOrgWithOwner(db, { name: 'ReportOrg', slug: 'report-org', userId: 'u1' });
  orgId = org.id;

  const proj = await createProject(db, org.id, { name: 'ReportProj', slug: 'report-proj' });
  projectId = proj.id;

  // Seed a Slack conversation so getSlackConversation resolves
  const convo = await findOrCreateSlackConversation(db, {
    orgId,
    projectId,
    assistantId: null,
    slackChannelId: CHANNEL,
    slackThreadTs: THREAD_TS,
  });
  conversationId = convo.id;

  // Enable reports at both org and project levels
  await setOrgReportsEnabled(db, orgId, true);
  await setProjectReportsEnabled(db, orgId, projectId, true);
});

afterAll(async () => { await t.stop(); });

function makeCtx(override?: Partial<ReportToolCtx>): ReportToolCtx {
  return {
    db,
    orgId,
    projectId,
    slackThread: { channel: CHANNEL, threadTs: THREAD_TS },
    ...override,
  };
}

describe('offer_investigation_report', () => {
  it('gate ON + slack context → creates an offered row and returns awaitingUser: true', async () => {
    const res = await offerInvestigationReport(makeCtx(), {});
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content);
    expect(parsed.status).toBe('offered');
    expect(parsed.mode).toBe('queue');
    expect(parsed.awaitingUser).toBe(true);
    expect(typeof parsed.offerId).toBe('string');

    // The offer row must exist in Firestore (unposted = no slackMessageTs)
    const offer = await getUnpostedReportOfferForConversation(db, conversationId);
    expect(offer).not.toBeNull();
    expect(offer!.id).toBe(parsed.offerId);
    expect(offer!.slackMessageTs).toBeNull();
  });

  it('gate OFF → no offer row created, returns not-enabled error', async () => {
    // Seed a separate org+project with reports gate OFF
    const gateOffOrg = await createOrgWithOwner(db, { name: 'GateOff', slug: 'report-gate-off', userId: 'u2' });
    const gateOffProj = await createProject(db, gateOffOrg.id, { name: 'Proj', slug: 'proj-gateoff' });
    await findOrCreateSlackConversation(db, {
      orgId: gateOffOrg.id,
      projectId: gateOffProj.id,
      assistantId: null,
      slackChannelId: 'RC2',
      slackThreadTs: '444.4',
    });
    // NOTE: do NOT enable reports — gate is OFF by default

    const gateOffCtx: ReportToolCtx = {
      db,
      orgId: gateOffOrg.id,
      projectId: gateOffProj.id,
      slackThread: { channel: 'RC2', threadTs: '444.4' },
    };

    const res = await offerInvestigationReport(gateOffCtx, {});
    expect(res.isError).toBe(true);
    expect(res.content).toContain('not enabled');
  });

  it('no slack thread context → returns a Slack-required error', async () => {
    const res = await offerInvestigationReport(makeCtx({ slackThread: undefined }), {});
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Slack');
  });
});
