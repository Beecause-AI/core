import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { createStore } from '../../src/store/firestore.js';
import { PgStore, createSchema } from '../../src/adapters/store/postgres.js';
import { PgVectorIndex } from '../../src/adapters/vector/pgvector.js';

let container: StartedPostgreSqlContainer;
let pgvectorContainer: StartedPostgreSqlContainer;
beforeAll(async () => {
  [container, pgvectorContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine').start(),
    new PostgreSqlContainer('pgvector/pgvector:pg16').start(),
  ]);
}, 180_000);
afterAll(() => Promise.all([container?.stop(), pgvectorContainer?.stop()]));

describe('createStore backend selection', () => {
  it('backend=postgres builds a working PgStore-backed Store', async () => {
    const store = createStore({
      backend: 'postgres',
      databaseUrl: container.getConnectionUri(),
      projectId: 'unused',
      vector: { location: '', indexId: '', indexEndpointId: '', deployedIndexId: '' },
    });
    await store.db.collection('projects').doc('p1').set({ orgId: 'o1', name: 'x' });
    const snap = await store.db.collection('projects').doc('p1').get();
    expect(snap.data()).toMatchObject({ orgId: 'o1', name: 'x' });
    await store.close();
  });
});

describe('createStore vectorBackend=pgvector', () => {
  it('createStore with vectorBackend=pgvector returns a PgVectorIndex that round-trips upsert + findNeighbors', async () => {
    const store = createStore({
      backend: 'postgres',
      databaseUrl: pgvectorContainer.getConnectionUri(),
      vectorBackend: 'pgvector',
      vectorDim: 3,
      projectId: 'x',
      vector: { location: '', indexId: '', indexEndpointId: '', deployedIndexId: '' },
    });
    // Confirm the vector index is a PgVectorIndex instance.
    expect(store.vector).toBeInstanceOf(PgVectorIndex);

    // Lazy schema init happens on first upsert — no await needed in createStore.
    await store.vector.upsert([{ id: 'a', embedding: [1, 0, 0] }]);
    const neighbors = await store.vector.findNeighbors([1, 0, 0], { limit: 1 });
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0]?.id).toBe('a');
    // Cosine distance of identical vectors = 0.
    expect(neighbors[0]?.distance).toBeCloseTo(0, 5);

    await store.close();
  });
});

describe('createSchema DDL-from-COLLECTIONS', () => {
  it('creates all COLLECTIONS tables + orgId/createdAt expression indexes, and a query on orgId works', async () => {
    const pool = new Pool({ connectionString: container.getConnectionUri() });
    try {
      await createSchema(pool);

      // Confirm the projects table was created (representative of COLLECTIONS).
      const tableCheck = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (
          SELECT 1 FROM pg_tables
          WHERE schemaname = 'public' AND tablename = 'projects'
        ) AS exists`,
      );
      expect(tableCheck.rows[0]?.exists).toBe(true);

      // Confirm expression indexes exist for projects.
      const idxCheck = await pool.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
         WHERE tablename = 'projects' AND indexname IN ('projects_orgId', 'projects_createdAt')`,
      );
      const indexNames = idxCheck.rows.map((r: { indexname: string }) => r.indexname).sort();
      expect(indexNames).toEqual(['projects_createdAt', 'projects_orgId']);

      // Insert docs and filter on orgId — confirms the index-backed path works.
      const store = new PgStore(pool);
      await store.collection('projects').doc('schema-test-1').set({ orgId: 'org-a', name: 'p1' });
      await store.collection('projects').doc('schema-test-2').set({ orgId: 'org-b', name: 'p2' });

      const results = await store
        .collection('projects')
        .where('orgId', '==', 'org-a')
        .get();
      const found = results.find((s) => s.id === 'schema-test-1');
      expect(found).toBeDefined();
      expect(found?.data()).toMatchObject({ orgId: 'org-a', name: 'p1' });

      // org-b doc should NOT be in the result set.
      const notFound = results.find((s) => s.id === 'schema-test-2');
      expect(notFound).toBeUndefined();
    } finally {
      await pool.end();
    }
  });
});
