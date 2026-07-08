import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type SentryCreds = { mode: 'auth_token'; token: string };

/** Decode a connection's stored Sentry credentials. */
export function credsForConnection(
  conn: { mode: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): SentryCreds {
  const plaintext = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
  if (conn.mode === 'auth_token') return { mode: 'auth_token', token: plaintext };
  throw new Error(`unknown sentry mode: ${conn.mode}`);
}

export function authHeaders(creds: SentryCreds): Record<string, string> {
  return { Authorization: `Bearer ${creds.token}` };
}
