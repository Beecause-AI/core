import type { Db } from '@intellilabs/core';

/**
 * Firestore reads/writes the KG build phases need that the knowledge-graph repo
 * does not expose as named functions. These mirror the old direct-drizzle queries
 * over `kg_nodes`/`kg_edges`, keyed by `buildId` + `kind`/`relation`.
 *
 * Firestore `in` filters take ≤30 values; the kind/relation lists here are tiny
 * (≤7) so a single query suffices, but we chunk defensively.
 */

const IN_CHUNK = 30;
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export type KgNodeRow = {
  id: string;
  name: string;
  kind: string;
  digest: string | null;
  businessFlow: string | null;
  repoFullName: string | null;
  metadata: unknown;
};

function toNodeRow(id: string, d: FirebaseFirestore.DocumentData): KgNodeRow {
  return {
    id,
    name: (d.name as string) ?? '',
    kind: (d.kind as string) ?? '',
    digest: (d.digest as string | null) ?? null,
    businessFlow: (d.businessFlow as string | null) ?? null,
    repoFullName: (d.repoFullName as string | null) ?? null,
    metadata: d.metadata ?? null,
  };
}

/** Nodes for a build whose `kind` is one of `kinds`. */
export async function nodesByKind(db: Db, buildId: string, kinds: string[]): Promise<KgNodeRow[]> {
  if (kinds.length === 0) return [];
  const out: KgNodeRow[] = [];
  for (const c of chunk(kinds, IN_CHUNK)) {
    const filter = c.length === 1
      ? db.collection('kg_nodes').where('buildId', '==', buildId).where('kind', '==', c[0])
      : db.collection('kg_nodes').where('buildId', '==', buildId).where('kind', 'in', c);
    const snaps = await filter.get();
    for (const s of snaps) out.push(toNodeRow(s.id, s.data() ?? {}));
  }
  return out;
}

/** Count of all nodes in a build (aggregation query — billed per index scan). */
export async function countNodes(db: Db, buildId: string): Promise<number> {
  return db.collection('kg_nodes').where('buildId', '==', buildId).count();
}

/** A build's running combined token total, or null when the build doc is gone. */
export async function buildTokens(db: Db, buildId: string): Promise<number | null> {
  const snap = await db.collection('kg_builds').doc(buildId).get();
  if (!snap.exists) return null;
  return (snap.data()?.tokens as number | null) ?? null;
}

export type KgEdgeRow = { src: string; dst: string };

/** Edges for a build with the given `relation`. */
export async function edgesByRelation(db: Db, buildId: string, relation: string): Promise<KgEdgeRow[]> {
  const snaps = await db.collection('kg_edges')
    .where('buildId', '==', buildId).where('relation', '==', relation).get();
  return snaps.map((s) => ({ src: s.data()?.srcNodeId as string, dst: s.data()?.dstNodeId as string }));
}

/** Delete all edges of a build whose `relation` is one of `relations` (idempotency). */
export async function deleteEdgesByRelation(db: Db, buildId: string, relations: string[]): Promise<void> {
  if (relations.length === 0) return;
  const ids: string[] = [];
  for (const c of chunk(relations, IN_CHUNK)) {
    const filter = c.length === 1
      ? db.collection('kg_edges').where('buildId', '==', buildId).where('relation', '==', c[0])
      : db.collection('kg_edges').where('buildId', '==', buildId).where('relation', 'in', c);
    const snaps = await filter.get();
    for (const s of snaps) ids.push(s.id);
  }
  for (const c of chunk(ids, 500)) {
    const batch = db.batch();
    for (const docId of c) batch.delete(db.collection('kg_edges').doc(docId));
    await batch.commit();
  }
}
