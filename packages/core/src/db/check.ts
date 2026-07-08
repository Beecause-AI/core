// Ops doctor: report which DB we're pointed at, whether the integrations tables
// exist, and the most recent applied migrations. Read-only. Run via `make db-check`.
import { sql } from 'drizzle-orm';
import { createDb } from './client.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const host = (() => { try { const u = new URL(url); return `${u.host}${u.pathname}`; } catch { return '(unparseable)'; } })();
const { db, pool } = createDb(url);

const tables = await db.execute(sql`
  select to_regclass('public.org_integrations') as org_integrations,
         to_regclass('public.integration_events') as integration_events,
         to_regclass('public.org_model_keys') as org_model_keys
`);
const migs = await db
  .execute(sql`select hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 6`)
  .then((r) => (r.rows ?? r))
  .catch((e) => [{ error: String(e) }]);

console.log('DBCHECK ' + JSON.stringify({ host, tables: (tables.rows ?? tables)[0], recentMigrations: migs }));
await pool.end();
