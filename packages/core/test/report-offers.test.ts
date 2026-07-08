import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import {
  createReportOffer, getReportOffer, getUnpostedOfferForConversation, setReportOfferMessageTs,
  getLatestOfferForConversation,
  claimReportOffer, declineReportOffer, markReportOfferGenerated,
} from '../src/repos/report-offers.js';

const t = testStore('report-offers');
afterAll(() => t.close());

function mk(cid: string) { return { orgId: 'o1', projectId: 'p1', conversationId: cid, slackChannelId: 'C1', slackThreadTs: '111.1' }; }

describe('report_offers repo', () => {
  it('creates an offered row found by getUnpostedOfferForConversation, then records the message ts', async () => {
    const cid = randomUUID();
    const offer = await createReportOffer(t.db, mk(cid));
    expect(offer.status).toBe('offered');
    expect((await getUnpostedOfferForConversation(t.db, cid))?.id).toBe(offer.id);
    await setReportOfferMessageTs(t.db, offer.id, '999.9');
    expect(await getUnpostedOfferForConversation(t.db, cid)).toBeNull(); // now has a messageTs
  });
  it('claim is winner-only (double-click guard)', async () => {
    const offer = await createReportOffer(t.db, mk(randomUUID()));
    expect(await claimReportOffer(t.db, offer.id)).toBe(true);
    expect(await claimReportOffer(t.db, offer.id)).toBe(false);
  });
  it('decline transitions and records who', async () => {
    const offer = await createReportOffer(t.db, mk(randomUUID()));
    await declineReportOffer(t.db, offer.id, 'U7');
    const got = await getReportOffer(t.db, offer.id);
    expect(got?.status).toBe('declined');
    expect(got?.decidedBy).toBe('U7');
  });
  it('getLatestOfferForConversation returns the most recent offer for the conversation', async () => {
    const cid = randomUUID();
    const first = await createReportOffer(t.db, mk(cid));
    await new Promise((r) => setTimeout(r, 5)); // guarantee a distinct createdAt
    const second = await createReportOffer(t.db, mk(cid));
    const latest = await getLatestOfferForConversation(t.db, cid);
    expect(latest?.id).toBe(second.id);
    expect(latest?.id).not.toBe(first.id);
    expect(await getLatestOfferForConversation(t.db, randomUUID())).toBeNull();
  });

  it('markGenerated records the report link', async () => {
    const offer = await createReportOffer(t.db, mk(randomUUID()));
    await claimReportOffer(t.db, offer.id);
    await markReportOfferGenerated(t.db, offer.id, { reportId: 'r1', reportUrl: 'https://x/r1', decidedBy: 'U7' });
    const got = await getReportOffer(t.db, offer.id);
    expect(got?.status).toBe('generated');
    expect(got?.reportUrl).toBe('https://x/r1');
  });
});
