import pg from 'pg';

// Runs ONCE after the entire Playwright run, decoupled from worker lifecycle.
//
// Why not a test.afterAll in prod-flow.spec.ts? A mid-suite test failure
// respawns the worker, and a worker-scoped afterAll fires at that teardown —
// deleting the shared test org while later tests still need it, turning one
// failure into a cascade. A global teardown runs exactly once, at the very end.
//
// Dev runs (run.sh) don't set the PROD_* env, so this is a no-op there.
export default async function globalTeardown() {
  const KC_ADMIN_SECRET = process.env.PROD_KC_ADMIN_SECRET;
  const DATABASE_URL = process.env.PROD_DATABASE_URL;
  const runId = process.env.E2E_RUN_ID;
  if (!KC_ADMIN_SECRET || !DATABASE_URL || !runId) return;

  const AUTH = 'https://auth.beecause.ai';
  const slug = `e2e-${runId}`;
  const email = `${slug}@e2e.beecause.ai`;

  // Realm: master kc-admin service account (404 = the run never provisioned it).
  try {
    const tokenRes = await fetch(`${AUTH}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: 'kc-admin',
        client_secret: KC_ADMIN_SECRET,
      }),
    });
    const { access_token } = (await tokenRes.json()) as { access_token: string };
    await fetch(`${AUTH}/admin/realms/${slug}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${access_token}` },
    });
  } catch (e) {
    console.warn('realm cleanup failed:', e);
  }

  // DB rows: org (+ memberships via cascade) and the user-email sync row.
  const client = new pg.Client({ connectionString: DATABASE_URL });
  try {
    await client.connect();
    await client.query('delete from users where email = $1', [email]);
    await client.query('delete from organizations where slug = $1', [slug]);
  } finally {
    await client.end().catch(() => {});
  }
}
