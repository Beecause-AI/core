// Pure persistence port (CRUD subset — queries/transactions are added as repos migrate).
// MUST NOT import cloud SDKs, adapters, or the cloud-coupled store/collections.ts
// (enforced by dependency-cruiser). Collection names are plain strings here; the typed
// CollectionName sugar lives in a helper layer introduced during repo migration.

export type DocData = Record<string, unknown>;

export type WhereOp = '==' | 'in' | '<';
export type OrderDir = 'asc' | 'desc';

/** Chainable read query. Operator set is intentionally tiny (the repo survey found only
 *  ==, in, <). `in` maps to the backend's native `in` (Firestore caps at 30; not auto-chunked). */
export interface Query {
  where(field: string, op: WhereOp, val: unknown): Query;
  orderBy(field: string, dir: OrderDir): Query;
  limit(n: number): Query;
  get(): Promise<Snapshot[]>;
  count(): Promise<number>;
  aggregate(spec: { sum?: string; count?: boolean }): Promise<{ sum?: number; count?: number }>;
}

/** Backend-agnostic sentinel for a server-computed field value. Each adapter interprets it. */
export type FieldSentinel =
  | { readonly __fv: 'serverTimestamp' }
  | { readonly __fv: 'increment'; readonly by: number };

export const FieldValue = {
  serverTimestamp(): FieldSentinel {
    return { __fv: 'serverTimestamp' };
  },
  increment(by: number): FieldSentinel {
    return { __fv: 'increment', by };
  },
};

/** Guard adapters use to detect sentinels while encoding a write payload. */
export function isFieldSentinel(v: unknown): v is FieldSentinel {
  return (
    typeof v === 'object' &&
    v !== null &&
    '__fv' in v &&
    ((v as { __fv: unknown }).__fv === 'serverTimestamp' ||
      (v as { __fv: unknown }).__fv === 'increment')
  );
}

export interface Snapshot {
  readonly id: string;
  readonly exists: boolean;
  data(): DocData | undefined;
}

export interface DocRef {
  readonly id: string;
  get(): Promise<Snapshot>;
  set(data: DocData, opts?: { merge?: boolean }): Promise<void>;
  update(data: DocData): Promise<void>;
  /** Write only if absent; rejects with {@link AlreadyExistsError} if the doc exists. */
  create(data: DocData): Promise<void>;
  delete(): Promise<void>;
}

/** A collection is a Query over all its documents, plus doc-by-id access.
 *  Omit `id` to get a new doc ref with a backend-generated random id. */
export interface CollectionRef extends Query {
  doc(id?: string): DocRef;
}

/** Transaction handle. Read-first: all `get`s must precede writes (a backend rule the repos
 *  honor). Writes are buffered and applied atomically on commit; the whole fn re-runs on a
 *  write conflict (optimistic retry). Writes take (ref, data) — the buffer lives on the txn. */
export interface Txn {
  get(ref: DocRef): Promise<Snapshot>;
  get(query: Query): Promise<Snapshot[]>;
  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: DocRef, data: DocData): void;
  create(ref: DocRef, data: DocData): void;
  delete(ref: DocRef): void;
}

/** Buffered atomic multi-write. No 500-op auto-chunking — callers chunk. */
export interface WriteBatch {
  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void;
  update(ref: DocRef, data: DocData): void;
  create(ref: DocRef, data: DocData): void;
  delete(ref: DocRef): void;
  commit(): Promise<void>;
}

export interface DocStore {
  collection(name: string): CollectionRef;
  /** Batched multi-get by ref; missing docs are returned with exists=false (callers filter). */
  getAll(...refs: DocRef[]): Promise<Snapshot[]>;
  /** Read-first transaction with optimistic retry — the fn re-runs on write conflict. */
  runTransaction<T>(fn: (tx: Txn) => Promise<T>): Promise<T>;
  batch(): WriteBatch;
  close(): Promise<void>;
}

/** Thrown by {@link DocRef.create} when the document already exists — idempotency-key
 *  writes (webhook deliveries, install nonces) branch on this. */
export class AlreadyExistsError extends Error {
  constructor(public readonly id: string) {
    super(`document already exists: ${id}`);
    this.name = 'AlreadyExistsError';
  }
}
