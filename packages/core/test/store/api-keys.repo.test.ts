import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  generateApiKey, hashApiKey, createApiKey, listApiKeys, revokeApiKey,
  findActiveApiKeyByHash, touchApiKeyLastUsed,
} from '../../src/repos/api-keys.js';

const store = testStore('api-keys');
const db = store.db;
const orgId = 'org-1';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('generateApiKey / hashApiKey', () => {
  it('mints a bee_-prefixed key whose prefix is the first 12 chars and whose hash is deterministic', () => {
    const { plaintext, keyHash, keyPrefix } = generateApiKey();
    expect(plaintext.startsWith('bee_')).toBe(true);
    expect(keyPrefix.length).toBe(12);
    expect(keyPrefix.startsWith('bee_')).toBe(true);
    expect(keyPrefix).toBe(plaintext.slice(0, 12));
    expect(keyHash).toBe(hashApiKey(plaintext));
    expect(keyHash).not.toContain(plaintext.slice(4));
  });
});

describe('createApiKey / listApiKeys', () => {
  it('returns the plaintext once and never exposes the hash in the public row', async () => {
    const { plaintext, row } = await createApiKey(db, { userId: 'u1', orgId, name: 'CI', expiresAt: null });
    expect(plaintext.startsWith('bee_')).toBe(true);
    expect(row.name).toBe('CI');
    expect(row.keyPrefix).toBe(plaintext.slice(0, 12));
    expect((row as Record<string, unknown>).keyHash).toBeUndefined();

    const keys = await listApiKeys(db, orgId, 'u1');
    expect(keys.some((k) => k.id === row.id)).toBe(true);
    expect((keys[0] as Record<string, unknown>).keyHash).toBeUndefined();
  });

  it('lists only the calling user, excluding revoked', async () => {
    await createApiKey(db, { userId: 'u1', orgId, name: 'mine', expiresAt: null });
    await createApiKey(db, { userId: 'u-other', orgId, name: 'theirs', expiresAt: null });
    const mine = await listApiKeys(db, orgId, 'u1');
    expect(mine.every((k) => k.name !== 'theirs')).toBe(true);
  });

  it('orders keys newest first', async () => {
    const a = await createApiKey(db, { userId: 'u-order', orgId, name: 'first', expiresAt: null });
    await new Promise((r) => setTimeout(r, 5));
    const b = await createApiKey(db, { userId: 'u-order', orgId, name: 'second', expiresAt: null });
    const keys = await listApiKeys(db, orgId, 'u-order');
    expect(keys[0]!.id).toBe(b.row.id);
    expect(keys[1]!.id).toBe(a.row.id);
  });
});

describe('revokeApiKey', () => {
  it('revokes an owned key once, then no-ops, and drops it from the list', async () => {
    const { row } = await createApiKey(db, { userId: 'u1', orgId, name: 'temp', expiresAt: null });
    expect(await revokeApiKey(db, { id: row.id, orgId, userId: 'u1' })).toBe(true);
    expect(await revokeApiKey(db, { id: row.id, orgId, userId: 'u1' })).toBe(false);
    const keys = await listApiKeys(db, orgId, 'u1');
    expect(keys.some((k) => k.id === row.id)).toBe(false);
  });

  it("won't revoke another user's key", async () => {
    const { row } = await createApiKey(db, { userId: 'u1', orgId, name: 'mine', expiresAt: null });
    expect(await revokeApiKey(db, { id: row.id, orgId, userId: 'u-other' })).toBe(false);
  });
});

describe('findActiveApiKeyByHash / touchApiKeyLastUsed', () => {
  it('finds an active key by hash and updates last-used; revoked keys are not found', async () => {
    const { plaintext, row } = await createApiKey(db, { userId: 'u1', orgId, name: 'live', expiresAt: null });
    const found = await findActiveApiKeyByHash(db, hashApiKey(plaintext));
    expect(found).toMatchObject({ id: row.id, userId: 'u1', orgId });

    await touchApiKeyLastUsed(db, row.id);
    const after = (await listApiKeys(db, orgId, 'u1')).find((k) => k.id === row.id)!;
    expect(after.lastUsedAt).not.toBeNull();

    await revokeApiKey(db, { id: row.id, orgId, userId: 'u1' });
    expect(await findActiveApiKeyByHash(db, hashApiKey(plaintext))).toBeNull();
  });
});
