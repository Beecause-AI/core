import { ClientSecretCredential, ClientAssertionCredential, type TokenCredential } from '@azure/identity';
import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type AzureCreds =
  | { mode: 'service_principal'; tenantId: string; clientId: string; clientSecret: string }
  | { mode: 'workload_identity'; tenantId: string; clientId: string; federationSubject: string };

export interface AzureAuthConfig {
  SECRETS_KEY?: string;
  AZURE_BASE_TENANT_ID?: string;
  AZURE_BASE_CLIENT_ID?: string;
  AZURE_BASE_FEDERATION_AUDIENCE?: string;
}

export interface AzureAuthDeps {
  /** Injectable for tests; default builds a real ClientSecretCredential. */
  makeSecretCredential?: (tenantId: string, clientId: string, clientSecret: string) => TokenCredential;
  /** Injectable for tests; default builds a real ClientAssertionCredential. */
  makeAssertionCredential?: (tenantId: string, clientId: string, getAssertion: () => Promise<string>) => TokenCredential;
  /** Injectable for tests; default mints a federated assertion from the platform identity. */
  getAssertion?: () => Promise<string>;
}

/** Decode a connection's stored credentials into an AzureCreds discriminated union. */
export function credsForConnection(
  conn: { mode: string; tenantId: string; clientId: string; secretCiphertext: string; federationSubject: string | null },
  cfg: { SECRETS_KEY?: string },
): AzureCreds {
  if (conn.mode === 'workload_identity') {
    if (!conn.federationSubject) throw new Error('workload_identity connection missing federationSubject');
    return { mode: 'workload_identity', tenantId: conn.tenantId, clientId: conn.clientId, federationSubject: conn.federationSubject };
  }
  if (conn.mode === 'service_principal') {
    const clientSecret = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
    return { mode: 'service_principal', tenantId: conn.tenantId, clientId: conn.clientId, clientSecret };
  }
  throw new Error(`unknown azure mode: ${conn.mode}`);
}

/** Platform-identity federated assertion. INERT until AZURE_BASE_* + a federation source are provisioned. */
const realGetAssertion = (_cfg: AzureAuthConfig) => async (): Promise<string> => {
  throw new Error('workload_identity is not yet provisioned — set AZURE_BASE_TENANT_ID/CLIENT_ID/FEDERATION_AUDIENCE and wire the platform federation source');
};

/** Turn stored creds into an Azure TokenCredential. service_principal works immediately;
 *  workload_identity needs the platform base configuration (dark-launched). */
export function resolveAzureCredential(creds: AzureCreds, cfg: AzureAuthConfig, deps: AzureAuthDeps = {}): TokenCredential {
  if (creds.mode === 'service_principal') {
    const make = deps.makeSecretCredential ?? ((t, c, s) => new ClientSecretCredential(t, c, s));
    return make(creds.tenantId, creds.clientId, creds.clientSecret);
  }
  if (!cfg.AZURE_BASE_TENANT_ID || !cfg.AZURE_BASE_CLIENT_ID || !cfg.AZURE_BASE_FEDERATION_AUDIENCE) {
    throw new Error('platform Azure base configuration is not set (AZURE_BASE_TENANT_ID/CLIENT_ID/FEDERATION_AUDIENCE) — required for workload_identity connections');
  }
  const getAssertion = deps.getAssertion ?? realGetAssertion(cfg);
  const make = deps.makeAssertionCredential ?? ((t, c, g) => new ClientAssertionCredential(t, c, g));
  return make(creds.tenantId, creds.clientId, getAssertion);
}
