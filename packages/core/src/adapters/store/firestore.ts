import {
  AggregateField,
  Firestore,
  FieldValue as FsFieldValue,
  Timestamp,
  type CollectionReference,
  type DocumentReference,
  type DocumentSnapshot,
  type Query as FsQuery,
  type Transaction as FsTransaction,
  type WriteBatch as FsWriteBatch,
} from '@google-cloud/firestore';
import {
  AlreadyExistsError,
  isFieldSentinel,
  type CollectionRef,
  type DocData,
  type DocRef,
  type DocStore,
  type OrderDir,
  type Query,
  type Snapshot,
  type Txn,
  type WhereOp,
  type WriteBatch,
} from '../../ports/store.js';

function deepDates(v: unknown): unknown {
  if (v instanceof Timestamp) return v.toDate();
  if (Array.isArray(v)) return v.map(deepDates);
  if (v && typeof v === 'object' && (v as object).constructor === Object) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = deepDates(val);
    return o;
  }
  return v;
}
function toSnapshot(snap: DocumentSnapshot): Snapshot {
  return {
    id: snap.id,
    exists: snap.exists,
    data: () => (snap.exists ? (deepDates(snap.data()) as DocData) : undefined),
  };
}

/** Replace port FieldValue sentinels in a write payload with the SDK's FieldValue ops. */
function encode(data: DocData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = isFieldSentinel(v)
      ? v.__fv === 'serverTimestamp'
        ? FsFieldValue.serverTimestamp()
        : FsFieldValue.increment(v.by)
      : v;
  }
  return out;
}

class FirestoreDocRef implements DocRef {
  constructor(private readonly ref: DocumentReference) {}
  get id(): string {
    return this.ref.id;
  }
  /** Underlying SDK ref — used by FirestoreStore.getAll to batch-read. */
  raw(): DocumentReference {
    return this.ref;
  }
  async get(): Promise<Snapshot> {
    return toSnapshot(await this.ref.get());
  }
  async set(data: DocData, opts?: { merge?: boolean }): Promise<void> {
    await this.ref.set(encode(data), opts?.merge ? { merge: true } : {});
  }
  async update(data: DocData): Promise<void> {
    await this.ref.update(encode(data));
  }
  async create(data: DocData): Promise<void> {
    try {
      await this.ref.create(encode(data));
    } catch (e) {
      // Firestore ALREADY_EXISTS is gRPC status code 6.
      if ((e as { code?: number }).code === 6) throw new AlreadyExistsError(this.ref.id);
      throw e;
    }
  }
  async delete(): Promise<void> {
    await this.ref.delete();
  }
}

function rawRef(ref: DocRef): DocumentReference {
  if (!(ref instanceof FirestoreDocRef)) throw new Error('DocRef is not from this FirestoreStore');
  return ref.raw();
}

class FirestoreQuery implements Query {
  constructor(protected readonly q: FsQuery) {}
  raw(): FsQuery {
    return this.q;
  }
  where(field: string, op: WhereOp, val: unknown): Query {
    return new FirestoreQuery(this.q.where(field, op, val));
  }
  orderBy(field: string, dir: OrderDir): Query {
    return new FirestoreQuery(this.q.orderBy(field, dir));
  }
  limit(n: number): Query {
    return new FirestoreQuery(this.q.limit(n));
  }
  async get(): Promise<Snapshot[]> {
    return (await this.q.get()).docs.map(toSnapshot);
  }
  async count(): Promise<number> {
    return (await this.q.count().get()).data().count;
  }
  async aggregate(spec: { sum?: string; count?: boolean }): Promise<{ sum?: number; count?: number }> {
    const fields: Record<string, ReturnType<typeof AggregateField.sum> | ReturnType<typeof AggregateField.count>> = {};
    if (spec.sum) fields.sum = AggregateField.sum(spec.sum);
    if (spec.count) fields.count = AggregateField.count();
    const data = (await this.q.aggregate(fields).get()).data() as { sum?: number; count?: number };
    return { sum: spec.sum ? data.sum : undefined, count: spec.count ? data.count : undefined };
  }
}

class FirestoreCollectionRef extends FirestoreQuery implements CollectionRef {
  constructor(c: CollectionReference) {
    super(c);
  }
  doc(id?: string): DocRef {
    // No id → auto-generate (Firestore SDK .doc() with no arg produces a random ref).
    return new FirestoreDocRef(id ? (this.q as CollectionReference).doc(id) : (this.q as CollectionReference).doc());
  }
}

class FirestoreTxn implements Txn {
  constructor(private readonly t: FsTransaction) {}
  get(ref: DocRef): Promise<Snapshot>;
  get(query: Query): Promise<Snapshot[]>;
  async get(refOrQuery: DocRef | Query): Promise<Snapshot | Snapshot[]> {
    if (refOrQuery instanceof FirestoreDocRef) return toSnapshot(await this.t.get(refOrQuery.raw()));
    if (refOrQuery instanceof FirestoreQuery) return (await this.t.get(refOrQuery.raw())).docs.map(toSnapshot);
    throw new Error('Txn.get: argument is not a FirestoreStore ref/query');
  }
  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void {
    this.t.set(rawRef(ref), encode(data), opts?.merge ? { merge: true } : {});
  }
  update(ref: DocRef, data: DocData): void {
    this.t.update(rawRef(ref), encode(data));
  }
  create(ref: DocRef, data: DocData): void {
    this.t.create(rawRef(ref), encode(data));
  }
  delete(ref: DocRef): void {
    this.t.delete(rawRef(ref));
  }
}

class FirestoreBatch implements WriteBatch {
  constructor(private readonly b: FsWriteBatch) {}
  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void {
    this.b.set(rawRef(ref), encode(data), opts?.merge ? { merge: true } : {});
  }
  update(ref: DocRef, data: DocData): void {
    this.b.update(rawRef(ref), encode(data));
  }
  create(ref: DocRef, data: DocData): void {
    this.b.create(rawRef(ref), encode(data));
  }
  delete(ref: DocRef): void {
    this.b.delete(rawRef(ref));
  }
  async commit(): Promise<void> {
    await this.b.commit();
  }
}

/** DocStore backed by the Firestore SDK. The current SaaS runtime uses this; the OSS
 *  Postgres adapter (a later plan) implements the same port against jsonb documents. */
export class FirestoreStore implements DocStore {
  constructor(private readonly db: Firestore) {}
  collection(name: string): CollectionRef {
    return new FirestoreCollectionRef(this.db.collection(name));
  }
  async getAll(...refs: DocRef[]): Promise<Snapshot[]> {
    if (refs.length === 0) return [];
    return (await this.db.getAll(...refs.map(rawRef))).map(toSnapshot);
  }
  runTransaction<T>(fn: (tx: Txn) => Promise<T>): Promise<T> {
    return this.db.runTransaction((t) => fn(new FirestoreTxn(t)));
  }
  batch(): WriteBatch {
    return new FirestoreBatch(this.db.batch());
  }
  close(): Promise<void> {
    return this.db.terminate();
  }
}
