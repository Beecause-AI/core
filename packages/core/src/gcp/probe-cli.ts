/**
 * Local GCP connectivity probe. Mints a token for every stored GCP connection (the step that
 * silently broke when google-auth-library used node-fetch) and runs a minimal read per signal
 * against each of the connection's target projects.
 *
 * Run via `make gcp-probe` (which injects DATABASE_URL + SECRETS_KEY from pulumi). Exits non-zero
 * if any token mint fails — that's the auth/transport failure we care about. Per-signal 403s are
 * reported as IAM hints, not probe failures.
 */
import pg from 'pg';
import { credsForConnection, mintToken, GCP_READONLY_SCOPES, GCP_ERRORREPORTING_SCOPES } from './auth.js';
import { realGcpClient } from './client.js';
import { probeSignals } from './probe.js';

const { DATABASE_URL, SECRETS_KEY } = process.env;
if (!DATABASE_URL || !SECRETS_KEY) {
  console.error('Set DATABASE_URL and SECRETS_KEY (use `make gcp-probe`).');
  process.exit(2);
}

const c = new pg.Client({ connectionString: DATABASE_URL });
await c.connect();
const conns = (await c.query('select id, mode, secret_ciphertext from gcp_connections')).rows as Array<{ id: string; mode: string; secret_ciphertext: string }>;
console.log(`GCP connections: ${conns.length}`);

const scopes = [...new Set([...GCP_READONLY_SCOPES, ...GCP_ERRORREPORTING_SCOPES])];
let mintFailures = 0;

for (const conn of conns) {
  console.log(`\n=== connection ${conn.id.slice(0, 8)} (mode=${conn.mode}) ===`);
  let token: string;
  try {
    const creds = credsForConnection({ mode: conn.mode, secretCiphertext: conn.secret_ciphertext }, { SECRETS_KEY });
    const t0 = Date.now();
    token = await mintToken(creds, scopes);
    console.log(`  ✓ mintToken OK (${Date.now() - t0}ms, token len=${token.length})`);
  } catch (e) {
    console.log(`  ✗ mintToken FAILED: ${e instanceof Error ? e.message.slice(0, 200) : String(e)}`);
    mintFailures++;
    continue;
  }
  const targets = (await c.query('select distinct gcp_project_id from gcp_targets where connection_id = $1', [conn.id])).rows as Array<{ gcp_project_id: string }>;
  if (!targets.length) { console.log('  (no target projects — token mint is the key check)'); continue; }
  for (const { gcp_project_id: gp } of targets) {
    const report = await probeSignals(realGcpClient, token, gp);
    const line = Object.entries(report).map(([sig, r]) => `${sig}:${r.ok ? '✓' : '✗'}`).join(' ');
    console.log(`  ${gp}: ${line}`);
    for (const [sig, r] of Object.entries(report)) if (!r.ok) console.log(`      ${sig}: ${r.error}`);
  }
}

await c.end();
console.log(mintFailures ? `\nFAIL: ${mintFailures} connection(s) could not mint a token.` : '\nOK: all connections minted a token.');
process.exit(mintFailures ? 1 : 0);
