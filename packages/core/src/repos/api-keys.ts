import { createHash, randomBytes } from 'node:crypto';
import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { ApiKey } from '../store/types.js';

// Newly minted keys are bee_-prefixed (Beecause). Legacy ilk_ keys still
// authenticate: the prefix is cosmetic — lookup is by sha256 of the full key
// (see findActiveApiKeyByHash), and the auth guard accepts both prefixes.
const PREFIX = 'bee_';

/** sha256 hex — the only representation of a key we persist or compare. */
export function hashApiKey(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** Mint a key. The plaintext is returned ONCE and never stored. */
export function generateApiKey(): { plaintext: string; keyHash: string; keyPrefix: string } {
  const plaintext = `${PREFIX}${randomBytes(24).toString('base64url')}`;
  return { plaintext, keyHash: hashApiKey(plaintext), keyPrefix: plaintext.slice(0, 12) };
}

export type ApiKeyPublic = Omit<ApiKey, 'keyHash'>;

/** Drop the hash so the secret never rides along in a list/create response
 *  (reproduces the SQL projection in JS). */
function toPublic(row: ApiKey): ApiKeyPublic {
  const { keyHash: _omit, ...pub } = row;
  return pub;
}

export async function createApiKey(
  db: Db,
  input: { userId: string; orgId: string; name: string; expiresAt: Date | null },
): Promise<{ plaintext: string; row: ApiKeyPublic }> {
  const { plaintext, keyHash, keyPrefix } = generateApiKey();
  const ref = col(db, 'api_keys').doc();
  const row = applyDefaults({
    userId: input.userId, orgId: input.orgId, name: input.name, keyHash, keyPrefix,
    expiresAt: input.expiresAt, lastUsedAt: null as Date | null, revokedAt: null as Date | null,
  }, ref.id);
  await ref.set(toDoc(row));
  return { plaintext, row: toPublic(fromDoc<ApiKey>(await ref.get())) };
}

/** Active (non-revoked) keys for a user within an org, newest first. */
export async function listApiKeys(db: Db, orgId: string, userId: string): Promise<ApiKeyPublic[]> {
  const snaps = await col(db, 'api_keys')
    .where('orgId', '==', orgId)
    .where('userId', '==', userId)
    .where('revokedAt', '==', null)
    .orderBy('createdAt', 'desc')
    .get();
  return snaps.map((d) => toPublic(fromDoc<ApiKey>(d)));
}

/** Revoke a key the caller owns in this org. Returns false if nothing matched. */
export async function revokeApiKey(
  db: Db,
  input: { id: string; orgId: string; userId: string },
): Promise<boolean> {
  const ref = col(db, 'api_keys').doc(input.id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  const row = fromDoc<ApiKey>(snap);
  if (row.orgId !== input.orgId || row.userId !== input.userId || row.revokedAt != null) return false;
  await ref.update(toDoc({ revokedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Auth lookup: active key by hash. Caller checks expiry + org match. */
export async function findActiveApiKeyByHash(
  db: Db,
  keyHash: string,
): Promise<{ id: string; userId: string; orgId: string; expiresAt: Date | null } | null> {
  const snaps = await col(db, 'api_keys')
    .where('keyHash', '==', keyHash)
    .where('revokedAt', '==', null)
    .get();
  const d = snaps[0];
  if (!d) return null;
  const row = fromDoc<ApiKey>(d);
  return { id: row.id, userId: row.userId, orgId: row.orgId, expiresAt: row.expiresAt };
}

export async function touchApiKeyLastUsed(db: Db, id: string): Promise<void> {
  await col(db, 'api_keys').doc(id).update(toDoc({ lastUsedAt: FieldValue.serverTimestamp() }));
}
