import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, setModelKey, setModelKeyEnabled, encryptSecret, keyFromBase64 } from '@intellilabs/core';
import type { ModelEntry } from '@intellilabs/engine';
import { makePlatformResolver } from '../src/engine/credential-resolver.js';
import { startTestDb, type TestDb } from './helpers.js';

const SK = Buffer.alloc(32, 7).toString('base64');
const secretsKey = keyFromBase64(SK);
const byokEntry: ModelEntry = { model: 'gemini-3-flash-preview', provider: 'google', credentialSource: 'byok', cancellation: 'in-flight', capabilities: { tools: false, streaming: true } };

let tdb: TestDb; let db: any; let orgId: string;

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-byok', userId: 'u1' });
  orgId = org.id;
});
afterAll(async () => { await tdb.stop(); });

describe('makePlatformResolver — byok decrypt', () => {
  it('decrypts an enabled google key to its plaintext apiKey', async () => {
    const plaintext = 'sk-byok-plaintext-123';
    await setModelKey(db, { orgId, provider: 'google', ciphertext: encryptSecret(plaintext, secretsKey), hint: 'pla...123' });
    await setModelKeyEnabled(db, orgId, 'google', true);
    const r = makePlatformResolver({ byok: { db, secretsKey } });
    await expect(r.resolve(byokEntry, orgId)).resolves.toEqual({ apiKey: plaintext });
  });

  it('throws when byok opts are not configured', async () => {
    const r = makePlatformResolver({});
    await expect(r.resolve(byokEntry, orgId)).rejects.toThrow(/not configured/i);
  });

  it('throws when the byok key is disabled', async () => {
    await setModelKeyEnabled(db, orgId, 'google', false);
    const r = makePlatformResolver({ byok: { db, secretsKey } });
    await expect(r.resolve(byokEntry, orgId)).rejects.toThrow(/no enabled BYOK key/i);
  });

  it('throws when no byok key exists for the provider', async () => {
    const r = makePlatformResolver({ byok: { db, secretsKey } });
    const otherEntry: ModelEntry = { ...byokEntry, provider: 'openai' };
    await expect(r.resolve(otherEntry, orgId)).rejects.toThrow(/no enabled BYOK key/i);
  });

  it('rejects (clean throw, no leak) when the key was encrypted under a different key', async () => {
    const plaintext = 'sk-wrong-key-secret-456';
    const wrongKey = keyFromBase64(Buffer.alloc(32, 9).toString('base64'));
    await setModelKey(db, { orgId, provider: 'google', ciphertext: encryptSecret(plaintext, wrongKey), hint: 'wro...456' });
    await setModelKeyEnabled(db, orgId, 'google', true);
    const r = makePlatformResolver({ byok: { db, secretsKey } });
    let caught: unknown;
    await expect(r.resolve(byokEntry, orgId).catch((e) => { caught = e; throw e; })).rejects.toThrow();
    const msg = caught instanceof Error ? caught.message : String(caught);
    expect(msg).not.toContain(plaintext);
    expect(msg).not.toContain(SK);
  });
});
