import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type DynatraceCreds = { mode: 'api_token'; environmentUrl: string; apiToken: string };

/** Normalize a tenant environment URL into the Environment API v2 base. */
export function apiBase(environmentUrl: string): string {
  return `${environmentUrl.replace(/\/+$/, '')}/api/v2`;
}

export function credsForConnection(
  conn: { environmentUrl: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): DynatraceCreds {
  const apiToken = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY ?? ''));
  return { mode: 'api_token', environmentUrl: conn.environmentUrl, apiToken };
}

export function dtHeaders(creds: DynatraceCreds): Record<string, string> {
  return { Authorization: `Api-Token ${creds.apiToken}`, 'Content-Type': 'application/json' };
}
