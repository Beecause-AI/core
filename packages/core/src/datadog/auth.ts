import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type DatadogSite = 'us1' | 'us3' | 'us5' | 'eu' | 'ap1' | 'us1-fed';

const SITE_BASE: Record<DatadogSite, string> = {
  us1: 'https://api.datadoghq.com',
  us3: 'https://api.us3.datadoghq.com',
  us5: 'https://api.us5.datadoghq.com',
  eu: 'https://api.datadoghq.eu',
  ap1: 'https://api.ap1.datadoghq.com',
  'us1-fed': 'https://api.ddog-gov.com',
};

export function siteBaseUrl(site: string): string {
  return SITE_BASE[(site as DatadogSite)] ?? SITE_BASE.us1;
}

export type DatadogCreds = { mode: 'api_keys'; apiKey: string; appKey: string; site: DatadogSite };

export function credsForConnection(
  conn: { site: string; secretCiphertext: string },
  cfg: { SECRETS_KEY?: string },
): DatadogCreds {
  const raw = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY ?? ''));
  const parsed = JSON.parse(raw) as { apiKey: string; appKey: string };
  return { mode: 'api_keys', apiKey: parsed.apiKey, appKey: parsed.appKey, site: ((conn.site as DatadogSite) || 'us1') };
}

export function ddHeaders(creds: DatadogCreds): Record<string, string> {
  return { 'DD-API-KEY': creds.apiKey, 'DD-APPLICATION-KEY': creds.appKey, 'Content-Type': 'application/json' };
}
