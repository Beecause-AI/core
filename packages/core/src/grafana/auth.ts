import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type GrafanaCreds = { mode: 'grafana'; token: string };

/** Decode a connection's stored Grafana service-account token. */
export function credsForConnection(
  conn: { mode: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): GrafanaCreds {
  const plaintext = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
  if (conn.mode === 'grafana') return { mode: 'grafana', token: plaintext };
  throw new Error(`unknown grafana mode: ${conn.mode}`);
}

export function authHeaders(creds: GrafanaCreds): Record<string, string> {
  return { Authorization: `Bearer ${creds.token}` };
}
