import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOrgWithOwner, setModelKey, setModelKeyEnabled } from '@intellilabs/core';
import { ModelRegistry } from '@intellilabs/engine';
import { makeResolveEntry } from '../src/engine/resolve-entry.js';
import { startTestDb, type TestDb } from './helpers.js';

let tdb: TestDb; let db: any; let orgId: string;
const platformEntry = { model: 'gemini-3-flash-preview', provider: 'google-vertex', credentialSource: 'platform' as const, cancellation: 'in-flight' as const, capabilities: { tools: false, streaming: true }, byokProvider: 'google' };

beforeAll(async () => {
  tdb = startTestDb();
  db = tdb.db;
  const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme-re', userId: 'u1' });
  orgId = org.id;
});
afterAll(async () => { await tdb.stop(); });

describe('makeResolveEntry', () => {
  it('returns the platform entry when the org has no enabled key', async () => {
    const resolve = makeResolveEntry(new ModelRegistry([platformEntry]), db, true);
    const e = await resolve('gemini-3-flash-preview', orgId);
    expect(e.provider).toBe('google-vertex');
    expect(e.credentialSource).toBe('platform');
  });
  it('returns a byok entry when the org has an enabled key for byokProvider', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'C', hint: 'h' });
    await setModelKeyEnabled(db, orgId, 'google', true);
    const resolve = makeResolveEntry(new ModelRegistry([platformEntry]), db, true);
    const e = await resolve('gemini-3-flash-preview', orgId);
    expect(e.provider).toBe('google');
    expect(e.credentialSource).toBe('byok');
  });
  it('falls back to platform when byok is not configured (byokEnabled=false) even with an enabled key', async () => {
    await setModelKey(db, { orgId, provider: 'google', ciphertext: 'C', hint: 'h' });
    await setModelKeyEnabled(db, orgId, 'google', true);
    const resolve = makeResolveEntry(new ModelRegistry([platformEntry]), db, false);
    const e = await resolve('gemini-3-flash-preview', orgId);
    expect(e.provider).toBe('google-vertex');
    expect(e.credentialSource).toBe('platform');
  });
  it('stays platform when the key is disabled', async () => {
    await setModelKeyEnabled(db, orgId, 'google', false);
    const resolve = makeResolveEntry(new ModelRegistry([platformEntry]), db, true);
    expect((await resolve('gemini-3-flash-preview', orgId)).provider).toBe('google-vertex');
  });
});
