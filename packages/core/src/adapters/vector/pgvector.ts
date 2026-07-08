import type { Pool } from 'pg';
import type { Neighbor, VectorIndex, VectorPoint } from '../../ports/vector.js';

/**
 * Creates the pgvector extension and the `vector_points` table for a given dimension.
 * Safe to call multiple times (IF NOT EXISTS guards).
 * `dim` MUST be a positive integer — it is interpolated into DDL.
 */
export async function createVectorSchema(pool: Pool, dim: number): Promise<void> {
  const d = Math.trunc(dim);
  if (!Number.isFinite(d) || d <= 0) throw new Error(`dim must be a positive integer, got ${dim}`);
  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vector_points (
      id        text        PRIMARY KEY,
      embedding vector(${d}) NOT NULL,
      restricts jsonb       NOT NULL DEFAULT '{}'::jsonb
    )
  `);
}

/** Postgres + pgvector implementation of VectorIndex. */
export class PgVectorIndex implements VectorIndex {
  private readonly dim: number;
  /**
   * Memoised schema-init promise.  The first call to upsert/findNeighbors resolves this;
   * subsequent calls reuse the same promise, so CREATE TABLE runs exactly once.
   * createStore stays synchronous because the await happens inside the operation, not in
   * the constructor.
   */
  private schemaReady: Promise<void> | null = null;

  constructor(
    private readonly pool: Pool,
    opts: { dim: number },
  ) {
    const d = Math.trunc(opts.dim);
    if (!Number.isFinite(d) || d <= 0) {
      throw new Error(`dim must be a positive integer, got ${opts.dim}`);
    }
    this.dim = d;
  }

  /** Ensures the extension + table exist (memoised — runs at most once per instance). */
  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = createVectorSchema(this.pool, this.dim);
    }
    return this.schemaReady;
  }

  /** Test helper — clears all rows without touching the schema. */
  async reset(): Promise<void> {
    await this.ensureSchema();
    await this.pool.query('TRUNCATE vector_points');
  }

  async upsert(points: VectorPoint[]): Promise<void> {
    if (points.length === 0) return;
    await this.ensureSchema();
    for (const p of points) {
      const embLiteral = '[' + p.embedding.join(',') + ']';
      const restrictsJson = JSON.stringify(p.restricts ?? {});
      await this.pool.query(
        `INSERT INTO vector_points (id, embedding, restricts)
         VALUES ($1, $2::vector, $3::jsonb)
         ON CONFLICT (id) DO UPDATE
           SET embedding = excluded.embedding,
               restricts = excluded.restricts`,
        [p.id, embLiteral, restrictsJson],
      );
    }
  }

  async remove(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.ensureSchema();
    await this.pool.query('DELETE FROM vector_points WHERE id = ANY($1)', [ids]);
  }

  async findNeighbors(
    embedding: number[],
    opts: { limit: number; filter?: Record<string, string[]> },
  ): Promise<Neighbor[]> {
    await this.ensureSchema();
    const limit = Math.trunc(opts.limit);
    if (!Number.isFinite(limit) || limit <= 0) {
      throw new Error(`limit must be a positive integer, got ${opts.limit}`);
    }

    const queryLiteral = '[' + embedding.join(',') + ']';
    // $1 is always the query vector
    const params: unknown[] = [queryLiteral];
    const clauses: string[] = [];

    for (const [ns, values] of Object.entries(opts.filter ?? {})) {
      if (values.length === 0) continue;
      // Parameterise both the namespace key and the values array.
      // restricts->>$k  = ANY($v::text[])
      const nsIdx = params.push(ns);       // e.g. $2
      const vIdx  = params.push(values);   // e.g. $3
      clauses.push(`restricts->>$${nsIdx} = ANY($${vIdx}::text[])`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

    const sql = `
      SELECT id,
             embedding <=> $1::vector AS distance
      FROM   vector_points
      ${whereClause}
      ORDER BY embedding <=> $1::vector
      LIMIT  ${limit}
    `;

    const result = await this.pool.query<{ id: string; distance: string }>(sql, params);
    return result.rows.map((row) => ({ id: row.id, distance: Number(row.distance) }));
  }
}
