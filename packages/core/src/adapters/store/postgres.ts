import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
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
import { COLLECTIONS } from '../../store/collections.js';

// ── Date round-trip ───────────────────────────────────────────────────────────
// jsonb has no Date type. On write, every Date becomes a sortable ISO-8601 UTC
// string (so `<` / orderBy sort chronologically, since ISO-UTC lexical == chrono).
// On read, strings matching the strict ISO-UTC pattern are revived to Date,
// recursively. This mirrors FirestoreStore's `deepDates`. Non-date string fields
// (ids, slugs, tokens) don't match the pattern.
// DIVERGENCE from FirestoreStore: a Date is stored as a jsonb *string*, not a native
// timestamp — so a raw jsonb read (bypassing reviveDates) sees a string here vs a
// Firestore Timestamp there. The revived DocData is the same on both backends.
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

function encodeDates(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(encodeDates);
  if (v && typeof v === 'object' && (v as object).constructor === Object) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = encodeDates(val);
    return o;
  }
  return v;
}

function reviveDates(v: unknown): unknown {
  if (typeof v === 'string') return ISO_UTC.test(v) ? new Date(v) : v;
  if (Array.isArray(v)) return v.map(reviveDates);
  if (v && typeof v === 'object' && (v as object).constructor === Object) {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) o[k] = reviveDates(val);
    return o;
  }
  return v;
}

function toSnapshot(id: string, doc: DocData | undefined): Snapshot {
  return {
    id,
    exists: doc !== undefined,
    data: () => (doc === undefined ? undefined : (reviveDates(doc) as DocData)),
  };
}

// ── FieldValue → SQL ──────────────────────────────────────────────────────────
// A write's `data` is split into (a) static plain fields folded into one jsonb
// object and merged with `||`, and (b) FieldValue sentinels + dotted keys applied
// as `jsonb_set` expressions composed left-to-right. Every expression is anchored
// on `base` (the pre-write column value: `doc` for merge/update, `'{}'::jsonb` for
// a non-merge replace), so increments read the current value and independent fields
// don't interfere.
interface WriteExpr {
  /** SQL expression producing the new jsonb doc, using `$1` for the row id. */
  sql: string;
  /** Positional params for the expression, starting at `$2`. */
  params: unknown[];
}

/** dotted "a.b" → text[] path {a,b}; a plain key → single-element path. */
function fieldPath(field: string): string[] {
  return field.split('.');
}

function buildWriteExpr(base: string, data: DocData, ts: string): WriteExpr {
  const params: unknown[] = [];
  // $1 is always the row id; field params begin at $2. Every param is registered
  // eagerly (in field order) so the `$n` indices always match the params array.
  const p = (val: unknown): string => {
    params.push(val);
    return `$${params.length + 1}`;
  };

  // A nested write to path {a,b,c} via jsonb_set no-ops when an ancestor (a, or a.b) is
  // missing — jsonb_set can't fill a hole (I2). Before setting the leaf, ensure every
  // proper ancestor exists by setting it to itself-or-'{}' (a no-op when already an
  // object, so sibling keys under it are preserved). Ancestor path params are registered
  // eagerly, shortest→longest, so `$n` indices stay aligned. Depth-1 paths add nothing.
  const ensureAncestors = (path: string[]): Array<(expr: string) => string> => {
    const wraps: Array<(expr: string) => string> = [];
    for (let i = 1; i < path.length; i++) {
      const preParam = p(path.slice(0, i));
      wraps.push(
        (expr) =>
          `jsonb_set(${expr}, ${preParam}::text[], COALESCE(${expr} #> ${preParam}::text[], '{}'::jsonb), true)`,
      );
    }
    return wraps;
  };

  const staticFields: Record<string, unknown> = {};
  // Each wrapper takes the accumulated expression and wraps it in one jsonb_set.
  const wrappers: Array<(expr: string) => string> = [];
  let hasStatic = false;

  for (const [field, v] of Object.entries(data)) {
    const path = fieldPath(field);
    if (isFieldSentinel(v)) {
      const ancestors = ensureAncestors(path);
      const pathParam = p(path);
      if (v.__fv === 'serverTimestamp') {
        const tsParam = p(ts);
        wrappers.push(...ancestors);
        wrappers.push((expr) => `jsonb_set(${expr}, ${pathParam}::text[], to_jsonb(${tsParam}::text), true)`);
      } else {
        const byParam = p(v.by);
        wrappers.push(...ancestors);
        // Increment reads from the pre-write column (`base`), not the accumulator, so
        // independent increments compose regardless of order.
        wrappers.push(
          (expr) =>
            `jsonb_set(${expr}, ${pathParam}::text[], ` +
            `(COALESCE((${base} #>> ${pathParam}::text[])::numeric, 0) + ${byParam})::text::jsonb, true)`,
        );
      }
    } else if (field.includes('.')) {
      // Dotted plain key → nested jsonb_set (not a literal top-level key).
      const ancestors = ensureAncestors(path);
      const pathParam = p(path);
      const valParam = p(JSON.stringify(encodeDates(v)));
      wrappers.push(...ancestors);
      wrappers.push((expr) => `jsonb_set(${expr}, ${pathParam}::text[], ${valParam}::jsonb, true)`);
    } else {
      staticFields[field] = encodeDates(v);
      hasStatic = true;
    }
  }

  let expr = base;
  if (hasStatic) expr = `${expr} || ${p(JSON.stringify(staticFields))}::jsonb`;
  for (const wrap of wrappers) expr = wrap(expr);
  return { sql: expr, params };
}

// ── SQL helpers ───────────────────────────────────────────────────────────────
type Runner = Pool | PoolClient;

/** Postgres identifier quoting for a collection name → table name. */
function tableName(collection: string): string {
  return `"${collection.replace(/"/g, '""')}"`;
}

/** Collection tables this module has created, keyed by pool. Shared across every PgStore
 *  wrapping the same pool (and populated by `createSchema`) so `reset()` can TRUNCATE only
 *  the tables we own — never unrelated tables that happen to share the `public` schema. */
const createdTables = new WeakMap<Pool, Set<string>>();
function noteCreated(pool: Pool, collection: string): void {
  let set = createdTables.get(pool);
  if (!set) {
    set = new Set();
    createdTables.set(pool, set);
  }
  set.add(collection);
}

const CREATE_RACE_CODES = new Set(['23505', '42P07', 'XX000']);

/** Lazily `CREATE TABLE IF NOT EXISTS` per collection, memoized per store so a table
 *  is DDL'd at most once. Concurrent CREATE races (duplicate pg_type/pg_class) are
 *  swallowed — the table ends up present either way. */
class TableRegistry {
  private readonly ensured = new Map<string, Promise<void>>();
  constructor(private readonly pool: Pool) {}
  ensure(collection: string): Promise<void> {
    let pending = this.ensured.get(collection);
    if (!pending) {
      pending = this.pool
        .query(
          `CREATE TABLE IF NOT EXISTS ${tableName(collection)} (id text primary key, doc jsonb not null)`,
        )
        .then(() => noteCreated(this.pool, collection))
        .catch((e: unknown) => {
          const code = (e as { code?: string }).code;
          if (code && CREATE_RACE_CODES.has(code)) {
            noteCreated(this.pool, collection); // concurrent create — table exists now
            return;
          }
          this.ensured.delete(collection);
          throw e;
        });
      this.ensured.set(collection, pending);
    }
    return pending;
  }
  invalidate(): void {
    this.ensured.clear();
  }
}

function isAlreadyExists(e: unknown): boolean {
  return (e as { code?: string }).code === '23505';
}

// ── DocRef ────────────────────────────────────────────────────────────────────
class PgDocRef implements DocRef {
  constructor(
    readonly id: string,
    readonly collection: string,
    private readonly store: PgStore,
  ) {}

  async get(): Promise<Snapshot> {
    await this.store.tables.ensure(this.collection);
    const r = await this.store.pool.query<{ doc: DocData }>(
      `SELECT doc FROM ${tableName(this.collection)} WHERE id = $1`,
      [this.id],
    );
    return toSnapshot(this.id, r.rows[0]?.doc);
  }

  async set(data: DocData, opts?: { merge?: boolean }): Promise<void> {
    await this.store.tables.ensure(this.collection);
    await setOn(this.store.pool, this.collection, this.id, data, opts);
  }

  async update(data: DocData): Promise<void> {
    await this.store.tables.ensure(this.collection);
    await updateOn(this.store.pool, this.collection, this.id, data);
  }

  async create(data: DocData): Promise<void> {
    await this.store.tables.ensure(this.collection);
    try {
      await createOn(this.store.pool, this.collection, this.id, data);
    } catch (e) {
      if (isAlreadyExists(e)) throw new AlreadyExistsError(this.id);
      throw e;
    }
  }

  async delete(): Promise<void> {
    await this.store.tables.ensure(this.collection);
    await deleteOn(this.store.pool, this.collection, this.id);
  }
}

// ── shared write executors (used by DocRef, Txn, WriteBatch) ───────────────────
const nowIso = (): string => new Date().toISOString();

async function setOn(
  runner: Runner,
  collection: string,
  id: string,
  data: DocData,
  opts?: { merge?: boolean },
): Promise<void> {
  const ts = nowIso();
  const merge = opts?.merge === true;
  // Insert path always starts from an empty doc; on conflict, merge reads the
  // existing row (table-qualified — bare `doc` is ambiguous vs EXCLUDED in DO UPDATE),
  // non-merge replaces from empty.
  const insert = buildWriteExpr(`'{}'::jsonb`, data, ts);
  const conflict = buildWriteExpr(merge ? `${tableName(collection)}.doc` : `'{}'::jsonb`, data, ts);
  // The conflict expr's field params ($2, $3, …) follow the insert's in one array,
  // so shift them by the number of insert field params (id occupies $1 in both).
  await runner.query(
    `INSERT INTO ${tableName(collection)} (id, doc) VALUES ($1, ${insert.sql}) ` +
      `ON CONFLICT (id) DO UPDATE SET doc = ${offsetParams(conflict.sql, insert.params.length)}`,
    [id, ...insert.params, ...conflict.params],
  );
}

async function updateOn(runner: Runner, collection: string, id: string, data: DocData): Promise<void> {
  const built = buildWriteExpr('doc', data, nowIso());
  const r = await runner.query(
    `UPDATE ${tableName(collection)} SET doc = ${built.sql} WHERE id = $1`,
    [id, ...built.params],
  );
  if (r.rowCount === 0) throw new Error(`update on missing document: ${id}`);
}

async function createOn(runner: Runner, collection: string, id: string, data: DocData): Promise<void> {
  const built = buildWriteExpr(`'{}'::jsonb`, data, nowIso());
  await runner.query(`INSERT INTO ${tableName(collection)} (id, doc) VALUES ($1, ${built.sql})`, [
    id,
    ...built.params,
  ]);
}

async function deleteOn(runner: Runner, collection: string, id: string): Promise<void> {
  // No-op on missing (do NOT assert rowCount).
  await runner.query(`DELETE FROM ${tableName(collection)} WHERE id = $1`, [id]);
}

/** Shift every `$n` (n>=2) in a built expression by `off` so two expressions can
 *  share one params array (used to place the ON CONFLICT expr after the INSERT expr). */
function offsetParams(sql: string, off: number): string {
  return sql.replace(/\$(\d+)/g, (_m, d: string) => {
    const n = Number(d);
    return n === 1 ? '$1' : `$${n + off}`;
  });
}

// ── Query ─────────────────────────────────────────────────────────────────────
interface Filter {
  field: string;
  op: WhereOp;
  val: unknown;
}
interface Order {
  field: string;
  dir: OrderDir;
}

class PgQuery implements Query {
  constructor(
    protected readonly store: PgStore,
    protected readonly collection: string,
    protected readonly filters: Filter[] = [],
    protected readonly orders: Order[] = [],
    protected readonly limitN?: number,
  ) {}

  where(field: string, op: WhereOp, val: unknown): Query {
    return this.clone({ filters: [...this.filters, { field, op, val }] });
  }
  orderBy(field: string, dir: OrderDir): Query {
    return this.clone({ orders: [...this.orders, { field, dir }] });
  }
  limit(n: number): Query {
    return this.clone({ limitN: n });
  }

  protected clone(patch: {
    filters?: Filter[];
    orders?: Order[];
    limitN?: number;
  }): PgQuery {
    return new PgQuery(
      this.store,
      this.collection,
      patch.filters ?? this.filters,
      patch.orders ?? this.orders,
      patch.limitN ?? this.limitN,
    );
  }

  /** Build the WHERE clause + params; params start at $1.
   *  Comparisons are on the jsonb VALUE (`doc #> path`), not its text projection, so
   *  numbers compare numerically while ISO-8601-UTC date strings still compare
   *  chronologically (jsonb orders strings lexically, and ISO-UTC is lexical=chrono).
   *  The compared literal is the value encoded as jsonb via the SAME encoding used on
   *  write (`jsonbLiteral`): a JS number → jsonb number, a Date → its ISO string as a
   *  jsonb string, any other string → a jsonb string. */
  private whereClause(): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const clauses: string[] = [];
    for (const f of this.filters) {
      const path = fieldPath(f.field);
      const col = `(doc #> $${push(params, path)}::text[])`;
      if (f.op === '==') {
        clauses.push(`${col} = $${push(params, jsonbLiteral(f.val))}::jsonb`);
      } else if (f.op === '<') {
        clauses.push(`${col} < $${push(params, jsonbLiteral(f.val))}::jsonb`);
      } else {
        // in — jsonb-value equality against any element (each element encoded as jsonb).
        const arr = (f.val as unknown[]).map(jsonbLiteral);
        clauses.push(`${col} = ANY($${push(params, arr)}::jsonb[])`);
      }
    }
    return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
  }

  /** ORDER BY on the jsonb VALUE (`doc #> path`) so numbers sort numerically and
   *  ISO-8601-UTC date strings sort chronologically (see whereClause). The field path
   *  is parameterized as `$n::text[]` — never interpolated — like the WHERE clause. */
  private orderLimit(params: unknown[]): string {
    let sql = '';
    if (this.orders.length) {
      const parts = this.orders.map(
        (o) => `doc #> $${push(params, fieldPath(o.field))}::text[] ${o.dir === 'desc' ? 'DESC' : 'ASC'}`,
      );
      sql += ` ORDER BY ${parts.join(', ')}`;
    }
    if (this.limitN !== undefined) sql += ` LIMIT ${Math.trunc(this.limitN)}`;
    return sql;
  }

  get(): Promise<Snapshot[]> {
    return this.getWith(this.store.pool);
  }

  /** Run the SELECT against a specific runner — the pool for a plain read, or the
   *  txn client so `Txn.get(query)` reads the transaction snapshot. */
  async getWith(runner: Runner): Promise<Snapshot[]> {
    await this.store.tables.ensure(this.collection);
    const w = this.whereClause();
    // orderLimit appends its ORDER BY path params after the WHERE params (shared array).
    const orderLimit = this.orderLimit(w.params);
    const r = await runner.query<{ id: string; doc: DocData }>(
      `SELECT id, doc FROM ${tableName(this.collection)} ${w.sql}${orderLimit}`,
      w.params,
    );
    return r.rows.map((row) => toSnapshot(row.id, row.doc));
  }

  async count(): Promise<number> {
    await this.store.tables.ensure(this.collection);
    const w = this.whereClause();
    const r = await this.store.pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${tableName(this.collection)} ${w.sql}`,
      w.params,
    );
    return Number(r.rows[0]?.count ?? 0);
  }

  async aggregate(spec: { sum?: string; count?: boolean }): Promise<{ sum?: number; count?: number }> {
    await this.store.tables.ensure(this.collection);
    const w = this.whereClause();
    const sel: string[] = [];
    if (spec.sum) {
      // Parameterize the summed field path as `$n::text[]` (like WHERE) — no identifier
      // interpolation. `#>>`→text→numeric is a value cast for the arithmetic aggregate
      // (not a comparison), so text extraction is fine here.
      sel.push(`COALESCE(SUM((doc #>> $${push(w.params, fieldPath(spec.sum))}::text[])::numeric), 0)::text AS sum`);
    }
    if (spec.count) sel.push(`COUNT(*)::text AS count`);
    if (sel.length === 0) return {};
    const r = await this.store.pool.query<{ sum?: string; count?: string }>(
      `SELECT ${sel.join(', ')} FROM ${tableName(this.collection)} ${w.sql}`,
      w.params,
    );
    const row = r.rows[0];
    const out: { sum?: number; count?: number } = {};
    if (spec.sum) out.sum = Number(row?.sum ?? 0);
    if (spec.count) out.count = Number(row?.count ?? 0);
    return out;
  }
}

/** Encode a query comparison operand as a jsonb text literal, matching the on-write
 *  encoding so `doc #> path <op> $n::jsonb` compares like-for-like: a Date → its
 *  ISO-8601-UTC string as a jsonb string (chronological == lexical), everything else
 *  (number, boolean, string, null) → its natural JSON form (number → jsonb number, so
 *  the compare is numeric). The result is bound as a text param and cast `::jsonb`. */
function jsonbLiteral(v: unknown): string {
  return JSON.stringify(v instanceof Date ? v.toISOString() : v);
}
function push(params: unknown[], v: unknown): number {
  params.push(v);
  return params.length;
}

// ── CollectionRef ─────────────────────────────────────────────────────────────
class PgCollectionRef extends PgQuery implements CollectionRef {
  doc(id?: string): DocRef {
    return new PgDocRef(id ?? randomUUID(), this.collection, this.store);
  }
}

function asDocRef(ref: DocRef): PgDocRef {
  if (!(ref instanceof PgDocRef)) throw new Error('DocRef is not from this PgStore');
  return ref;
}

// ── Transaction ───────────────────────────────────────────────────────────────
class PgTxn implements Txn {
  constructor(
    private readonly store: PgStore,
    private readonly client: PoolClient,
  ) {}

  get(ref: DocRef): Promise<Snapshot>;
  get(query: Query): Promise<Snapshot[]>;
  async get(refOrQuery: DocRef | Query): Promise<Snapshot | Snapshot[]> {
    if (refOrQuery instanceof PgDocRef) {
      const d = asDocRef(refOrQuery);
      await this.store.tables.ensure(d.collection);
      const r = await this.client.query<{ doc: DocData }>(
        `SELECT doc FROM ${tableName(d.collection)} WHERE id = $1`,
        [d.id],
      );
      return toSnapshot(d.id, r.rows[0]?.doc);
    }
    if (refOrQuery instanceof PgQuery) {
      // Run the query on the txn client so it reads the txn snapshot.
      return refOrQuery.getWith(this.client);
    }
    throw new Error('Txn.get: argument is not a PgStore ref/query');
  }

  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void {
    const d = asDocRef(ref);
    this.enqueue(async () => {
      await this.store.tables.ensure(d.collection);
      await setOn(this.client, d.collection, d.id, data, opts);
    });
  }
  update(ref: DocRef, data: DocData): void {
    const d = asDocRef(ref);
    this.enqueue(async () => {
      await this.store.tables.ensure(d.collection);
      await updateOn(this.client, d.collection, d.id, data);
    });
  }
  create(ref: DocRef, data: DocData): void {
    const d = asDocRef(ref);
    this.enqueue(async () => {
      await this.store.tables.ensure(d.collection);
      try {
        await createOn(this.client, d.collection, d.id, data);
      } catch (e) {
        if (isAlreadyExists(e)) throw new AlreadyExistsError(d.id);
        throw e;
      }
    });
  }
  delete(ref: DocRef): void {
    const d = asDocRef(ref);
    this.enqueue(async () => {
      await this.store.tables.ensure(d.collection);
      await deleteOn(this.client, d.collection, d.id);
    });
  }

  // Writes are buffered (read-first port rule) and flushed after the fn body, so a
  // failing write (e.g. update-on-missing, create-conflict) surfaces before commit.
  private readonly buffer: Array<() => Promise<void>> = [];
  private enqueue(op: () => Promise<void>): void {
    this.buffer.push(op);
  }
  async flush(): Promise<void> {
    for (const op of this.buffer) await op();
  }
}

// ── WriteBatch ────────────────────────────────────────────────────────────────
class PgBatch implements WriteBatch {
  private readonly ops: Array<(client: PoolClient) => Promise<void>> = [];
  constructor(private readonly store: PgStore) {}

  set(ref: DocRef, data: DocData, opts?: { merge?: boolean }): void {
    const d = asDocRef(ref);
    this.ops.push(async (c) => {
      await this.store.tables.ensure(d.collection);
      await setOn(c, d.collection, d.id, data, opts);
    });
  }
  update(ref: DocRef, data: DocData): void {
    const d = asDocRef(ref);
    this.ops.push(async (c) => {
      await this.store.tables.ensure(d.collection);
      await updateOn(c, d.collection, d.id, data);
    });
  }
  create(ref: DocRef, data: DocData): void {
    const d = asDocRef(ref);
    this.ops.push(async (c) => {
      await this.store.tables.ensure(d.collection);
      try {
        await createOn(c, d.collection, d.id, data);
      } catch (e) {
        if (isAlreadyExists(e)) throw new AlreadyExistsError(d.id);
        throw e;
      }
    });
  }
  delete(ref: DocRef): void {
    const d = asDocRef(ref);
    this.ops.push(async (c) => {
      await this.store.tables.ensure(d.collection);
      await deleteOn(c, d.collection, d.id);
    });
  }

  async commit(): Promise<void> {
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      for (const op of this.ops) await op(client);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }
}

// ── DocStore ──────────────────────────────────────────────────────────────────
const SERIALIZATION_FAILURE = '40001';
const TXN_MAX_ATTEMPTS = 5;

export class PgStore implements DocStore {
  readonly tables: TableRegistry;
  constructor(readonly pool: Pool) {
    this.tables = new TableRegistry(pool);
  }

  collection(name: string): CollectionRef {
    return new PgCollectionRef(this, name);
  }

  async getAll(...refs: DocRef[]): Promise<Snapshot[]> {
    if (refs.length === 0) return [];
    const pgRefs = refs.map(asDocRef);
    // getAll is by-ref; the contract uses a single collection. Group by collection
    // and fetch each group with `id = ANY`, preserving the requested order.
    const byCollection = new Map<string, PgDocRef[]>();
    for (const r of pgRefs) {
      const g = byCollection.get(r.collection) ?? [];
      g.push(r);
      byCollection.set(r.collection, g);
    }
    const found = new Map<string, DocData>();
    for (const [collection, group] of byCollection) {
      await this.tables.ensure(collection);
      const ids = group.map((r) => r.id);
      const res = await this.pool.query<{ id: string; doc: DocData }>(
        `SELECT id, doc FROM ${tableName(collection)} WHERE id = ANY($1)`,
        [ids],
      );
      // Separator between collection and id so (col `ab`, id `c`) can't collide with
      // (col `a`, id `bc`). A space can't appear in a collection (table) name.
      for (const row of res.rows) found.set(`${collection} ${row.id}`, row.doc);
    }
    return pgRefs.map((r) => toSnapshot(r.id, found.get(`${r.collection} ${r.id}`)));
  }

  async runTransaction<T>(fn: (tx: Txn) => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < TXN_MAX_ATTEMPTS; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
        const tx = new PgTxn(this, client);
        const result = await fn(tx);
        await tx.flush();
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        if ((e as { code?: string }).code === SERIALIZATION_FAILURE) {
          lastErr = e;
          continue; // optimistic retry on serialization failure
        }
        throw e;
      } finally {
        client.release();
      }
    }
    throw lastErr;
  }

  batch(): WriteBatch {
    return new PgBatch(this);
  }

  async close(): Promise<void> {
    // The pool is owned by the caller (shared across stores/tests); do not end it.
  }

  // ── test/DDL helpers ─────────────────────────────────────────────────────────
  /** TRUNCATE the collection tables THIS module created on this pool (fast, transactional
   *  reset for tests) — never other tables sharing the `public` schema (e.g. app tables).
   *  Intersected with the live pg_tables so a manually-dropped table is skipped. */
  async reset(): Promise<void> {
    const tracked = createdTables.get(this.pool);
    if (!tracked || tracked.size === 0) return;
    const r = await this.pool.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = ANY($1)`,
      [[...tracked]],
    );
    const names = r.rows.map((row) => row.tablename);
    if (names.length === 0) return;
    const list = names.map(tableName).join(', ');
    await this.pool.query(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
  }
}

/** Create the table for every registered collection. Ad-hoc collections are created
 *  lazily on first access, so this is a convenience for the real (non-test) schema.
 *  Also creates expression indexes on the hot query fields orgId + createdAt for every
 *  collection. Expression indexes on a missing key are valid in Postgres (index the
 *  result of the expression, which is NULL when the key is absent) — harmless for
 *  collections that don't have that field. */
export async function createSchema(pool: Pool): Promise<void> {
  for (const name of Object.values(COLLECTIONS)) {
    const t = tableName(name);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${t} (id text primary key, doc jsonb not null)`);
    noteCreated(pool, name); // track for PgStore.reset()
    // Expression indexes on hot query fields.  The index name uses the raw collection
    // name (double any embedded quotes) so it's stable and human-readable.
    const idxBase = name.replace(/"/g, '""');
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "${idxBase}_orgId" ON ${t} ((doc->>'orgId'))`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS "${idxBase}_createdAt" ON ${t} ((doc->>'createdAt'))`,
    );
  }
}
