import { afterAll, beforeAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { docStoreContract } from '../../testing/port-contracts/store.js';
import { PgStore, createSchema } from '../../src/adapters/store/postgres.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
  await createSchema(pool); // CREATE TABLE per COLLECTIONS
}, 120_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

// Fresh, isolated data per test: each makeStore() TRUNCATEs all collection tables.
docStoreContract('postgres', async () => {
  const store = new PgStore(pool);
  await store.reset(); // TRUNCATE every collection table
  return store;
});
