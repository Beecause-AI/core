import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type PagerDutyRegion = 'us' | 'eu';
export type PagerDutyCreds = { mode: 'api_keys'; region: PagerDutyRegion; apiToken: string };

/** PagerDuty REST API base URL for the account's service region. */
export function pdBaseUrl(region: string): string {
  return region === 'eu' ? 'https://api.eu.pagerduty.com' : 'https://api.pagerduty.com';
}

export function credsForConnection(
  conn: { region: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): PagerDutyCreds {
  const apiToken = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY ?? ''));
  return { mode: 'api_keys', region: conn.region === 'eu' ? 'eu' : 'us', apiToken };
}

export function pdHeaders(creds: PagerDutyCreds): Record<string, string> {
  return {
    Authorization: `Token token=${creds.apiToken}`,
    Accept: 'application/vnd.pagerduty+json;version=2',
    'Content-Type': 'application/json',
  };
}
