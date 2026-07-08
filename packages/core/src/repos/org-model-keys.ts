import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { fromDoc, toDoc, applyDefaults, FieldValue } from '../store/codec.js';
import type { OrgModelKey } from '../store/types.js';

export type ModelKeyPublic = Omit<OrgModelKey, 'keyCiphertext'>;

/** Composite PK (orgId, provider) → deterministic doc id. */
function keyId(orgId: string, provider: string): string {
  return `${orgId}_${provider}`;
}

/** Strip the ciphertext so the hash/secret never rides along in a list response. */
function toPublic(row: OrgModelKey): ModelKeyPublic {
  const { keyCiphertext: _omit, ...pub } = row;
  return pub;
}

/** Upsert a key. Insert defaults enabled=false; updating an existing row preserves its
 *  `enabled` (re-keying doesn't silently flip activation) and refreshes hint+ciphertext. */
export async function setModelKey(
  db: Db,
  input: { orgId: string; provider: string; ciphertext: string; hint: string; baseUrl?: string | null; lastTestOk?: boolean },
): Promise<void> {
  const ref = col(db, 'org_model_keys').doc(keyId(input.orgId, input.provider));
  const snap = await ref.get();
  if (snap.exists) {
    // onConflictDoUpdate: refresh ciphertext/hint/baseUrl/test fields; keep `enabled`.
    await ref.update(toDoc({
      keyCiphertext: input.ciphertext, keyHint: input.hint, baseUrl: input.baseUrl ?? null,
      lastTestedAt: FieldValue.serverTimestamp(), lastTestOk: input.lastTestOk ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    }));
    return;
  }
  const row = applyDefaults({
    orgId: input.orgId, provider: input.provider, keyCiphertext: input.ciphertext, keyHint: input.hint,
    enabled: false, baseUrl: input.baseUrl ?? null,
    lastTestedAt: FieldValue.serverTimestamp() as unknown as Date, lastTestOk: input.lastTestOk ?? null,
    updatedAt: FieldValue.serverTimestamp() as unknown as Date,
  }, ref.id);
  await ref.set(toDoc(row));
}

export async function setModelKeyEnabled(db: Db, orgId: string, provider: string, enabled: boolean): Promise<boolean> {
  const ref = col(db, 'org_model_keys').doc(keyId(orgId, provider));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update(toDoc({ enabled, updatedAt: FieldValue.serverTimestamp() }));
  return true;
}

/** Metadata only — never selects the ciphertext. */
export async function listModelKeys(db: Db, orgId: string): Promise<ModelKeyPublic[]> {
  const snaps = await col(db, 'org_model_keys').where('orgId', '==', orgId).get();
  return snaps.map((d) => toPublic(fromDoc<OrgModelKey>(d)));
}

export async function deleteModelKey(db: Db, orgId: string, provider: string): Promise<boolean> {
  const ref = col(db, 'org_model_keys').doc(keyId(orgId, provider));
  const snap = await ref.get();
  if (snap.exists) await ref.delete();
  return snap.exists;
}

/** Resolver-only: the ciphertext iff a row exists AND enabled, else null. */
export async function getEnabledKeyCiphertext(db: Db, orgId: string, provider: string): Promise<string | null> {
  const snap = await col(db, 'org_model_keys').doc(keyId(orgId, provider)).get();
  if (!snap.exists) return null;
  const row = fromDoc<OrgModelKey>(snap);
  return row.enabled ? row.keyCiphertext : null;
}

export async function setModelKeyTested(db: Db, orgId: string, provider: string, ok: boolean): Promise<boolean> {
  const ref = col(db, 'org_model_keys').doc(keyId(orgId, provider));
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.update(toDoc({ lastTestedAt: FieldValue.serverTimestamp(), lastTestOk: ok }));
  return true;
}

export async function getKeyCiphertext(db: Db, orgId: string, provider: string): Promise<{ ciphertext: string; baseUrl: string | null } | null> {
  const snap = await col(db, 'org_model_keys').doc(keyId(orgId, provider)).get();
  if (!snap.exists) return null;
  const row = fromDoc<OrgModelKey>(snap);
  return { ciphertext: row.keyCiphertext, baseUrl: row.baseUrl };
}

/** Cheap existence check for entry resolution (no ciphertext fetched). */
export async function hasEnabledModelKey(db: Db, orgId: string, provider: string): Promise<boolean> {
  const snap = await col(db, 'org_model_keys').doc(keyId(orgId, provider)).get();
  return snap.exists && (snap.data()?.enabled as boolean) === true;
}
