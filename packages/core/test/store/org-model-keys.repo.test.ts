import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  setModelKey, setModelKeyEnabled, listModelKeys, deleteModelKey,
  getEnabledKeyCiphertext, hasEnabledModelKey, getKeyCiphertext, setModelKeyTested,
} from '../../src/repos/org-model-keys.js';

const store = testStore('org-model-keys');
const db = store.db;
const orgId = 'org-1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('org-model-keys repo (Firestore)', () => {
  it('sets a key disabled by default; metadata never exposes the ciphertext', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'CIPHER', hint: '…1234' });
    const list = await listModelKeys(db, orgId);
    const row = list.find((r) => r.provider === 'google')!;
    expect(row.enabled).toBe(false);
    expect(row.keyHint).toBe('…1234');
    expect((row as Record<string, unknown>).keyCiphertext).toBeUndefined();
  });

  it('getEnabledKeyCiphertext returns null while disabled, the ciphertext once enabled', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'CIPHER', hint: '…1234' });
    expect(await getEnabledKeyCiphertext(db, orgId, 'google')).toBeNull();
    expect(await hasEnabledModelKey(db, orgId, 'google')).toBe(false);
    await setModelKeyEnabled(db, orgId, 'google', true);
    expect(await getEnabledKeyCiphertext(db, orgId, 'google')).toBe('CIPHER');
    expect(await hasEnabledModelKey(db, orgId, 'google')).toBe(true);
  });

  it('re-keying preserves the enabled flag and updates the hint + ciphertext', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'CIPHER', hint: '…1234' });
    await setModelKeyEnabled(db, orgId, 'google', true);
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'CIPHER2', hint: '…5678' });
    const row = (await listModelKeys(db, orgId)).find((r) => r.provider === 'google')!;
    expect(row.enabled).toBe(true);
    expect(row.keyHint).toBe('…5678');
    expect(await getEnabledKeyCiphertext(db, orgId, 'google')).toBe('CIPHER2');
  });

  it('delete removes the key', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'CIPHER', hint: '…1234' });
    expect(await deleteModelKey(db, orgId, 'google')).toBe(true);
    expect((await listModelKeys(db, orgId)).length).toBe(0);
    expect(await getEnabledKeyCiphertext(db, orgId, 'google')).toBeNull();
    expect(await deleteModelKey(db, orgId, 'google')).toBe(false);
  });

  it('getEnabledKeyCiphertext for an unknown provider is null', async () => {
    expect(await getEnabledKeyCiphertext(db, orgId, 'nope')).toBeNull();
  });

  it('setModelKeyEnabled on a missing row returns false', async () => {
    expect(await setModelKeyEnabled(db, orgId, 'nope', true)).toBe(false);
  });

  it('round-trips base_url + last_tested fields and exposes them in the public list', async () => {
    await setModelKey(db, { orgId, provider: 'openai-compatible', ciphertext: 'C1', hint: '…1234', baseUrl: 'https://api.groq.com/openai/v1', lastTestOk: true });
    const [row] = (await listModelKeys(db, orgId)).filter((r) => r.provider === 'openai-compatible');
    expect(row!.baseUrl).toBe('https://api.groq.com/openai/v1');
    expect(row!.lastTestOk).toBe(true);
    expect(row!.lastTestedAt).toBeInstanceOf(Date);
    expect((row as Record<string, unknown>).keyCiphertext).toBeUndefined();
  });

  it('getKeyCiphertext returns ciphertext + baseUrl regardless of enabled', async () => {
    await setModelKey(db, { orgId, provider: 'openai', ciphertext: 'SECRET', hint: '…99', lastTestOk: true });
    const got = await getKeyCiphertext(db, orgId, 'openai');
    expect(got).toEqual({ ciphertext: 'SECRET', baseUrl: null });
    expect(await getKeyCiphertext(db, orgId, 'nope')).toBeNull();
  });

  it('setModelKeyTested updates status without touching the key', async () => {
    await setModelKey(db, { orgId, provider: 'anthropic', ciphertext: 'K', hint: '…a', lastTestOk: true });
    expect(await setModelKeyTested(db, orgId, 'anthropic', false)).toBe(true);
    const [row] = (await listModelKeys(db, orgId)).filter((r) => r.provider === 'anthropic');
    expect(row!.lastTestOk).toBe(false);
    expect(await setModelKeyTested(db, orgId, 'nope', false)).toBe(false);
  });
});
