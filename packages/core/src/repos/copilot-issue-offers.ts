import { FieldValue } from '../store/codec.js';
import { col } from '../store/collections.js';
import { applyDefaults, toDoc, fromDoc } from '../store/codec.js';
import type { Db } from '../store/firestore.js';
import type { CopilotIssueOffer } from '../store/types.js';

export interface NewCopilotIssueOffer {
  orgId: string;
  projectId: string;
  conversationId: string;
  slackChannelId: string;
  slackThreadTs: string;
  repo: string | null;
  candidateRepos: string[];
  title: string;
  body: string;
  summary: string;
  provider: 'github' | 'gitlab';
}

export async function createCopilotIssueOffer(db: Db, input: NewCopilotIssueOffer): Promise<CopilotIssueOffer> {
  const ref = col(db, 'copilot_issue_offers').doc();
  const row = applyDefaults({
    orgId: input.orgId,
    provider: input.provider,
    projectId: input.projectId,
    conversationId: input.conversationId,
    slackChannelId: input.slackChannelId,
    slackThreadTs: input.slackThreadTs,
    slackMessageTs: null,
    repo: input.repo ?? null,
    candidateRepos: input.candidateRepos,
    title: input.title,
    body: input.body,
    summary: input.summary,
    status: 'offered',
    issueNumber: null,
    issueUrl: null,
    copilotAssigned: false,
    error: null,
    decidedBy: null,
    decidedAt: null,
  }, ref.id);
  await ref.set(toDoc(row));
  return fromDoc<CopilotIssueOffer>(await ref.get());
}

export async function getCopilotIssueOffer(db: Db, id: string): Promise<CopilotIssueOffer | null> {
  const snap = await col(db, 'copilot_issue_offers').doc(id).get();
  return snap.exists ? fromDoc<CopilotIssueOffer>(snap) : null;
}

/** The conversation's most recent offer that was created but not yet posted to Slack
 *  (status 'offered', no slackMessageTs) — i.e. a queued offer awaiting its deferred post.
 *  Single equality filter (auto-indexed); status/unposted filtering + ordering done in memory. */
export async function getUnpostedOfferForConversation(db: Db, conversationId: string): Promise<CopilotIssueOffer | null> {
  const snaps = await col(db, 'copilot_issue_offers').where('conversationId', '==', conversationId).get();
  const offers = snaps
    .map((d) => fromDoc<CopilotIssueOffer>(d))
    .filter((o) => o.status === 'offered' && !o.slackMessageTs)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return offers[0] ?? null;
}

export async function setCopilotIssueOfferMessageTs(db: Db, id: string, ts: string): Promise<void> {
  await col(db, 'copilot_issue_offers').doc(id).update(toDoc({ slackMessageTs: ts }));
}

/** offered → creating, race-safe. Returns true only for the request that wins the transition. */
export async function claimCopilotIssueOffer(db: Db, id: string): Promise<boolean> {
  const ref = col(db, 'copilot_issue_offers').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.['status'] !== 'offered') return false;
    tx.update(ref, toDoc({ status: 'creating' }));
    return true;
  });
}

/** offered → declined, race-safe + idempotent. */
export async function declineCopilotIssueOffer(db: Db, id: string, decidedBy: string | null): Promise<boolean> {
  const ref = col(db, 'copilot_issue_offers').doc(id);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.data()?.['status'] !== 'offered') return false;
    tx.update(ref, toDoc({ status: 'declined', decidedBy: decidedBy ?? null, decidedAt: FieldValue.serverTimestamp() }));
    return true;
  });
}

export async function markCopilotIssueOfferCreated(
  db: Db,
  id: string,
  r: { repo: string; issueNumber: number; issueUrl: string; copilotAssigned: boolean; error: string | null; decidedBy: string | null },
): Promise<void> {
  await col(db, 'copilot_issue_offers').doc(id).update(toDoc({
    status: 'created', repo: r.repo, issueNumber: r.issueNumber, issueUrl: r.issueUrl,
    copilotAssigned: r.copilotAssigned, error: r.error ?? null, decidedBy: r.decidedBy ?? null,
    decidedAt: FieldValue.serverTimestamp(),
  }));
}

export async function markCopilotIssueOfferFailed(
  db: Db,
  id: string,
  r: { error: string; decidedBy: string | null },
): Promise<void> {
  await col(db, 'copilot_issue_offers').doc(id).update(toDoc({
    status: 'failed', error: r.error, decidedBy: r.decidedBy ?? null, decidedAt: FieldValue.serverTimestamp(),
  }));
}
