import { STSClient, AssumeRoleCommand } from '@aws-sdk/client-sts';
import { decryptSecret, keyFromBase64 } from '../crypto/secrets.js';

export type AwsCreds =
  | { mode: 'access_key'; accessKeyId: string; secretAccessKey: string }
  | { mode: 'assume_role'; roleArn: string; externalId: string };

/** Short-lived credentials handed to the API clients. */
export interface ResolvedAwsCreds { accessKeyId: string; secretAccessKey: string; sessionToken?: string }

export interface AwsAuthConfig {
  SECRETS_KEY?: string;
  AWS_BASE_ACCESS_KEY_ID?: string;
  AWS_BASE_SECRET_ACCESS_KEY?: string;
  AWS_BASE_REGION?: string;
}

export interface AssumeRoleParams {
  roleArn: string; externalId: string; region: string;
  base: { accessKeyId: string; secretAccessKey: string; region: string };
}

export interface AwsAuthDeps {
  /** Injectable for tests; defaults to a real STS AssumeRole call. */
  assumeRole?: (p: AssumeRoleParams) => Promise<ResolvedAwsCreds>;
}

/** arn:aws:iam::<account>:role/... → '<account>' (12 digits), else null. */
export function accountFromRoleArn(arn: string): string | null {
  return /arn:aws[\w-]*:iam::(\d{12}):/.exec(arn)?.[1] ?? null;
}

/** Decode a connection's stored credentials into an AwsCreds discriminated union. */
export function credsForConnection(
  conn: { mode: string; secretCiphertext: string; roleArn: string | null; externalId: string | null },
  cfg: { SECRETS_KEY?: string },
): AwsCreds {
  if (conn.mode === 'assume_role') {
    if (!conn.roleArn || !conn.externalId) throw new Error('assume_role connection missing roleArn/externalId');
    return { mode: 'assume_role', roleArn: conn.roleArn, externalId: conn.externalId };
  }
  if (conn.mode === 'access_key') {
    const blob = decryptSecret(conn.secretCiphertext, keyFromBase64(cfg.SECRETS_KEY!));
    const { accessKeyId, secretAccessKey } = JSON.parse(blob) as { accessKeyId: string; secretAccessKey: string };
    return { mode: 'access_key', accessKeyId, secretAccessKey };
  }
  throw new Error(`unknown aws mode: ${conn.mode}`);
}

const realAssumeRole = async (p: AssumeRoleParams): Promise<ResolvedAwsCreds> => {
  const sts = new STSClient({ region: p.base.region, credentials: { accessKeyId: p.base.accessKeyId, secretAccessKey: p.base.secretAccessKey } });
  const out = await sts.send(new AssumeRoleCommand({
    RoleArn: p.roleArn, RoleSessionName: 'beecause-rca', ExternalId: p.externalId, DurationSeconds: 900,
  }));
  const c = out.Credentials;
  if (!c?.AccessKeyId || !c.SecretAccessKey) throw new Error('AssumeRole returned no credentials');
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretAccessKey, sessionToken: c.SessionToken };
};

/** Turn stored creds into short-lived credentials for `region`. access_key passes through;
 *  assume_role uses the platform base credentials to call STS AssumeRole. */
export async function resolveAwsCreds(
  creds: AwsCreds, region: string, cfg: AwsAuthConfig, deps: AwsAuthDeps = {},
): Promise<ResolvedAwsCreds> {
  if (creds.mode === 'access_key') {
    return { accessKeyId: creds.accessKeyId, secretAccessKey: creds.secretAccessKey };
  }
  if (!cfg.AWS_BASE_ACCESS_KEY_ID || !cfg.AWS_BASE_SECRET_ACCESS_KEY || !cfg.AWS_BASE_REGION) {
    throw new Error('platform AWS base credentials are not configured (AWS_BASE_ACCESS_KEY_ID/SECRET/REGION) — required for assume_role connections');
  }
  const assumeRole = deps.assumeRole ?? realAssumeRole;
  return assumeRole({
    roleArn: creds.roleArn, externalId: creds.externalId, region,
    base: { accessKeyId: cfg.AWS_BASE_ACCESS_KEY_ID, secretAccessKey: cfg.AWS_BASE_SECRET_ACCESS_KEY, region: cfg.AWS_BASE_REGION },
  });
}
