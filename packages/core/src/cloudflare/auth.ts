import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type CloudflareCreds =
  | { mode: 'api_token'; apiToken: string }
  | { mode: 'global_key'; email: string; apiKey: string };

/** Decode a connection's stored credentials. */
export function credsForConnection(
  conn: { mode: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): CloudflareCreds {
  const plaintext = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
  if (conn.mode === 'api_token') return { mode: 'api_token', apiToken: plaintext };
  if (conn.mode === 'global_key') {
    const { email, apiKey } = JSON.parse(plaintext) as { email: string; apiKey: string };
    return { mode: 'global_key', email, apiKey };
  }
  throw new Error(`unknown cloudflare mode: ${conn.mode}`);
}

export function authHeaders(creds: CloudflareCreds): Record<string, string> {
  return creds.mode === 'api_token'
    ? { Authorization: `Bearer ${creds.apiToken}` }
    : { 'X-Auth-Email': creds.email, 'X-Auth-Key': creds.apiKey };
}
