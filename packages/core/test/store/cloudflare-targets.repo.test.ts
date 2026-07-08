import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  addCloudflareTarget, listCloudflareTargets, cloudflareTargetExists,
  updateCloudflareTarget, removeCloudflareTarget, setCloudflareTargetSignals,
  toPublicCloudflareTarget,
} from '../../src/repos/cloudflare-targets.js';

const store = testStore('cloudflare-targets');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const base = { projectId: 'p1', connectionId: 'c1', addedByUserId: 'u1' };

describe('cloudflare-targets repo (Firestore)', () => {
  it('addCloudflareTarget returns a row with id + defaults', async () => {
    const row = await addCloudflareTarget(db, { ...base, kind: 'account', accountId: 'acc', name: 'Acct' });
    expect(row.id).toBeTruthy();
    expect(row.kind).toBe('account');
    expect(row.zoneId).toBeNull();
    expect(row.label).toBeNull();
    expect(row.workerScripts).toBeNull();
    expect(row.metadata).toEqual({});
  });

  it('listCloudflareTargets is project-scoped and sorted by name', async () => {
    await addCloudflareTarget(db, { ...base, kind: 'zone', accountId: 'acc', zoneId: 'z1', name: 'Zeta' });
    await addCloudflareTarget(db, { ...base, kind: 'zone', accountId: 'acc', zoneId: 'z2', name: 'Alpha' });
    await addCloudflareTarget(db, { ...base, projectId: 'other', kind: 'account', accountId: 'acc', name: 'X' });
    expect((await listCloudflareTargets(db, 'p1')).map((t) => t.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('cloudflareTargetExists matches account rows (zoneId null) and zone rows', async () => {
    await addCloudflareTarget(db, { ...base, kind: 'account', accountId: 'acc', name: 'Acct' });
    await addCloudflareTarget(db, { ...base, kind: 'zone', accountId: 'acc', zoneId: 'z1', name: 'Zone' });
    expect(await cloudflareTargetExists(db, 'p1', 'account', 'acc', null)).toBe(true);
    expect(await cloudflareTargetExists(db, 'p1', 'zone', 'acc', 'z1')).toBe(true);
    expect(await cloudflareTargetExists(db, 'p1', 'zone', 'acc', 'z2')).toBe(false);
    expect(await cloudflareTargetExists(db, 'other', 'account', 'acc', null)).toBe(false);
  });

  it('updateCloudflareTarget patches label/workerScripts; project-scoped', async () => {
    const row = await addCloudflareTarget(db, { ...base, kind: 'account', accountId: 'acc', name: 'Acct' });
    expect(await updateCloudflareTarget(db, 'p1', row.id, { label: 'Prod', workerScripts: ['w1'] })).toBe(true);
    const [updated] = await listCloudflareTargets(db, 'p1');
    expect(updated!.label).toBe('Prod');
    expect(updated!.workerScripts).toEqual(['w1']);
    expect(await updateCloudflareTarget(db, 'other', row.id, { label: 'X' })).toBe(false);
  });

  it('removeCloudflareTarget is project-scoped', async () => {
    const row = await addCloudflareTarget(db, { ...base, kind: 'account', accountId: 'acc', name: 'Acct' });
    expect(await removeCloudflareTarget(db, 'other', row.id)).toBe(false);
    expect(await removeCloudflareTarget(db, 'p1', row.id)).toBe(true);
    expect(await cloudflareTargetExists(db, 'p1', 'account', 'acc', null)).toBe(false);
  });

  it('setCloudflareTargetSignals merges availableSignals into metadata', async () => {
    const row = await addCloudflareTarget(db, { ...base, kind: 'account', accountId: 'acc', name: 'Acct' });
    await setCloudflareTargetSignals(db, row.id, ['analytics']);
    const [updated] = await listCloudflareTargets(db, 'p1');
    expect((updated!.metadata as { availableSignals?: string[] }).availableSignals).toEqual(['analytics']);
    await setCloudflareTargetSignals(db, 'missing', ['analytics']); // no throw
  });

  it('toPublicCloudflareTarget projects availableSignals', () => {
    const pub = toPublicCloudflareTarget({
      id: 't1', projectId: 'p1', connectionId: 'c1', kind: 'account', accountId: 'acc', zoneId: null,
      name: 'Acct', label: null, workerScripts: null, metadata: { availableSignals: ['analytics'] },
      addedByUserId: 'u1', createdAt: new Date(),
    });
    expect(pub.metadata.availableSignals).toEqual(['analytics']);
  });
});
