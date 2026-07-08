import { col } from '../store/collections.js';
import { applyDefaults, toDoc, fromDoc } from '../store/codec.js';
import type { Db } from '../store/firestore.js';
import type { ReportOffer } from '../store/types.js';

export interface NewReportOffer {
  orgId: string;
  projectId: string;
  conversationId: string;
  slackChannelId: string;
  slackThreadTs: string;
}

export async function createReportOffer(db: Db, input: NewReportOffer): Promise<ReportOffer> {
  const ref = col(db, 'report_offers').doc();
  const row = applyDefaults({
    orgId: input.orgId,
    projectId: input.projectId,
    conversationId: input.conversationId,
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    slackMessageTs: null,
    status: 'offered',
    reportId: null,
    reportUrl: null,
    error: null,
    decidedBy: null,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<ReportOffer>(await ref.get());
}

export async function getReportOffer(db: Db, id: string): Promise<ReportOffer | null> {
  const snap = await col(db, 'report_offers').doc(id).get();
  return snap.exists ? fromDoc<ReportOffer>(snap) : null;
}

/** The conversation's most recent offer that was created but not yet posted to Slack
 *  (status 'offered', no slackMessageTs) — i.e. a queued offer awaiting its deferred post.
 *  Single equality filter (auto-indexed); status/unposted filtering + ordering done in memory. */
export async function getUnpostedOfferForConversation(db: Db, conversationId: string): Promise<ReportOffer | null> {
  const snaps = await col(db, 'report_offers').where('conversationId', '==', conversationId).get();
  const offers = snaps
    .map((d) => fromDoc<ReportOffer>(d))
    .filter((o) => o.status === 'offered' && !o.slackMessageTs)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return offers[0] ?? null;
}

/** The conversation's most recent offer regardless of status, by createdAt desc.
 *  Single equality filter (auto-indexed); ordering done in memory like
 *  getUnpostedOfferForConversation, so no composite index is required. */
export async function getLatestOfferForConversation(db: Db, conversationId: string): Promise<ReportOffer | null> {
  const snaps = await col(db, 'report_offers').where('conversationId', '==', conversationId).get();
  const offers = snaps
    .map((d) => fromDoc<ReportOffer>(d))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return offers[0] ?? null;
}

export async function setReportOfferMessageTs(db: Db, id: string, ts: string): Promise<void> {
  await col(db, 'report_offers').doc(id).update(toDoc({ slackMessageTs: ts }));
}

/** offered → generating, race-safe. Returns true only for the request that wins the transition. */
export async function claimReportOffer(db: Db, id: string): Promise<boolean> {
  const ref = col(db, 'report_offers').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.['status'] !== 'offered') return false;
    tx.update(ref, toDoc({ status: 'generating' }));
    return true;
  });
}

/** offered → declined, race-safe. */
export async function declineReportOffer(db: Db, id: string, decidedBy: string): Promise<void> {
  const ref = col(db, 'report_offers').doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.['status'] !== 'offered') return;
    tx.update(ref, toDoc({ status: 'declined', decidedBy }));
  });
}

export async function markReportOfferGenerated(
  db: Db,
  id: string,
  args: { reportId: string; reportUrl: string; decidedBy: string },
): Promise<void> {
  await col(db, 'report_offers').doc(id).update(toDoc({
    status: 'generated',
    reportId: args.reportId,
    reportUrl: args.reportUrl,
    decidedBy: args.decidedBy,
  }));
}

export async function markReportOfferFailed(
  db: Db,
  id: string,
  args: { error: string; decidedBy: string },
): Promise<void> {
  await col(db, 'report_offers').doc(id).update(toDoc({
    status: 'failed',
    error: args.error,
    decidedBy: args.decidedBy,
  }));
}
