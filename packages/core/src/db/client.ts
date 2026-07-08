import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

// ── Firestore migration (transitional) ────────────────────────────────────────
// The new data layer lives in ../store/*. This module re-exports it so callers can
// migrate incrementally. The legacy Postgres `createDb`/`Db` below stay until the
// cutover task deletes this file (see docs/superpowers/plans/2026-06-20-firestore-migration.md).
export { createStore, type Store, type StoreConfig, type Db } from '../store/firestore.js';

/** @deprecated legacy Postgres handle — kept only for the one-time Neon→Firestore backfill tool. */
export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** @deprecated legacy Drizzle handle type — backfill tool only. */
export type LegacyDb = ReturnType<typeof createDb>['db'];
