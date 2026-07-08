import { afterAll, beforeAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { vectorIndexContract } from '../../testing/port-contracts/vector.js';
import { PgVectorIndex, createVectorSchema } from '../../src/adapters/vector/pgvector.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await createVectorSchema(pool, 3); // CREATE EXTENSION vector; CREATE TABLE vector_points(embedding vector(3))
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

vectorIndexContract('pgvector', async () => {
  const idx = new PgVectorIndex(pool, { dim: 3 });
  await idx.reset(); // TRUNCATE vector_points — fresh per test
  return idx;
});
