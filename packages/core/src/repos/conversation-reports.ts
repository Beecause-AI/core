import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults } from '../store/codec.js';
import type { ConversationReport } from '../store/types.js';

export interface NewConversationReport {
  conversationId: string;
  orgId: string;
  projectId: string;
  html: string;
  model?: string | null;
  costUsd?: string | null;
  createdBy?: string | null;
}

export async function createConversationReport(
  db: Db,
  input: NewConversationReport,
): Promise<ConversationReport> {
  const ref = col(db, 'conversation_reports').doc();

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(
      col(db, 'conversation_reports')
        .where('conversationId', '==', input.conversationId)
        .orderBy('version', 'desc')
        .limit(1),
    );
    const firstDoc = existing[0];
    const version = existing.length === 0 || !firstDoc ? 1 : (firstDoc.data()?.['version'] as number) + 1;
    const row = applyDefaults(
      {
        conversationId: input.conversationId,
        orgId: input.orgId,
        projectId: input.projectId,
        version,
        html: input.html,
        model: input.model ?? null,
        costUsd: input.costUsd ?? null,
        createdAt: new Date(),
        createdBy: input.createdBy ?? null,
      },
      ref.id,
    );
    tx.set(ref, toDoc(row));
  });

  return fromDoc<ConversationReport>(await ref.get());
}

export async function listReportsForConversation(
  db: Db,
  conversationId: string,
): Promise<ConversationReport[]> {
  const snaps = await col(db, 'conversation_reports')
    .where('conversationId', '==', conversationId)
    .orderBy('version', 'desc')
    .get();
  return snaps.map((d) => fromDoc<ConversationReport>(d));
}

export async function getLatestReport(
  db: Db,
  conversationId: string,
): Promise<ConversationReport | null> {
  const snaps = await col(db, 'conversation_reports')
    .where('conversationId', '==', conversationId)
    .orderBy('version', 'desc')
    .limit(1)
    .get();
  const firstSnap = snaps[0];
  return snaps.length === 0 || !firstSnap ? null : fromDoc<ConversationReport>(firstSnap);
}

export async function getConversationReport(
  db: Db,
  id: string,
): Promise<ConversationReport | null> {
  const snap = await col(db, 'conversation_reports').doc(id).get();
  return snap.exists ? fromDoc<ConversationReport>(snap) : null;
}
