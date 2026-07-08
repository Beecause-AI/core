import { JWT, ExternalAccountClient, GoogleAuth } from 'google-auth-library';
import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export const GCP_READONLY_SCOPES = [
  'https://www.googleapis.com/auth/monitoring.read',
  'https://www.googleapis.com/auth/logging.read',
  'https://www.googleapis.com/auth/trace.readonly',
];

// Error Reporting's REST API only accepts the broad cloud-platform scope (no
// narrow read scope exists). Minted only for the errors tools; actual access
// stays gated by the service account's roles/errorreporting.viewer IAM role.
export const GCP_ERRORREPORTING_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
];

export type GcpCreds =
  | { mode: 'sa_key'; saJson: string }
  | { mode: 'wif'; wifConfig: string };

/** Decode a connection's stored credentials. */
export function credsForConnection(
  conn: { mode: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): GcpCreds {
  const plaintext = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
  if (conn.mode === 'sa_key') return { mode: 'sa_key', saJson: plaintext };
  if (conn.mode === 'wif') return { mode: 'wif', wifConfig: plaintext };
  throw new Error(`unknown gcp mode: ${conn.mode}`);
}

// Injectable factories keep token minting unit-testable without network/key material.
export interface MintDeps {
  makeJwt?: (opts: { email: string; key: string; scopes: string[] }) => { getAccessToken: () => Promise<{ token?: string | null }> };
  makeWif?: (config: object, scopes: string[]) => { getAccessToken: () => Promise<{ token?: string | null }> };
  /** Injectable for tests; defaults to real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
}

// google-auth-library fetches the token from www.googleapis.com via node-fetch, whose connection
// reuse intermittently drops the response body mid-read ("Invalid response body while trying to
// fetch …"). That is transient — a retry clears it. Match network-level failures only; credential
// rejections (invalid_grant / 401, with a parseable body) are permanent and must NOT be retried.
const TRANSIENT_TOKEN_ERROR = /Invalid response body|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ECONNREFUSED|fetch failed|socket hang up|terminated|network (?:socket )?timeout|request to .* failed/i;
function isTransientTokenError(err: unknown): boolean {
  const cause = (err as { cause?: { message?: string } } | null)?.cause?.message ?? '';
  const msg = (err instanceof Error ? err.message : String(err)) + ' ' + cause;
  return TRANSIENT_TOKEN_ERROR.test(msg);
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `fn`, retrying on transient network failures with backoff. Permanent errors throw at once. */
async function withTokenRetry<T>(fn: () => Promise<T>, sleep: (ms: number) => Promise<void>): Promise<T> {
  const delays = [250, 750];
  let last: unknown;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return await fn(); }
    catch (err) {
      last = err;
      if (attempt === delays.length || !isTransientTokenError(err)) throw err;
      await sleep(delays[attempt]!);
    }
  }
  throw last;
}

export async function mintToken(creds: GcpCreds, scopes: string[], deps: MintDeps = {}): Promise<string> {
  const sleep = deps.sleep ?? realSleep;
  if (creds.mode === 'sa_key') {
    const sa = JSON.parse(creds.saJson) as { client_email: string; private_key: string };
    const makeJwt = deps.makeJwt ?? ((o) => new JWT({ email: o.email, key: o.key, scopes: o.scopes }));
    const client = makeJwt({ email: sa.client_email, key: sa.private_key, scopes });
    const { token } = await withTokenRetry(() => client.getAccessToken(), sleep);
    if (!token) throw new Error('failed to mint GCP access token (sa_key)');
    return token;
  }
  const config = JSON.parse(creds.wifConfig) as object;
  const makeWif = deps.makeWif ?? ((c, s) => {
    const client = ExternalAccountClient.fromJSON(c as never);
    if (!client) throw new Error('invalid WIF config');
    client.scopes = s;
    return client;
  });
  const client = makeWif(config, scopes);
  const { token } = await withTokenRetry(() => client.getAccessToken(), sleep);
  if (!token) throw new Error('failed to mint GCP access token (wif)');
  return token;
}

// Injectable factory keeps ambient minting unit-testable without ADC/network.
export interface AmbientDeps {
  makeAuth?: (scopes: string[]) => { getAccessToken: () => Promise<string | null | undefined> };
}

/** Mint an access token from Application Default Credentials (the Cloud Run
 *  metadata server in prod). Used for reporting into our OWN project — distinct
 *  from `mintToken`, which uses a connection's stored BYOK credentials. */
export async function mintAmbientToken(scopes: string[], deps: AmbientDeps = {}): Promise<string> {
  const makeAuth = deps.makeAuth ?? ((s) => new GoogleAuth({ scopes: s }));
  const auth = makeAuth(scopes);
  const token = await auth.getAccessToken();
  if (!token) throw new Error('failed to mint ambient GCP access token');
  return token;
}
