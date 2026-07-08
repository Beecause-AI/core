import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  addGcpTarget, listGcpTargets, gcpTargetExists, removeGcpTarget,
  setGcpTargetSignals, toPublicGcpTarget,
} from '../../src/repos/gcp-targets.js';

const store = testStore('gcp-targets');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const base = { projectId: 'p1', connectionId: 'c1', addedByUserId: 'u1' };

describe('gcp-targets repo (Firestore)', () => {
  it('addGcpTarget returns a row with id + defaults', async () => {
    const row = await addGcpTarget(db, { ...base, gcpProjectId: 'proj-a' });
    expect(row.id).toBeTruthy();
    expect(row.gcpProjectId).toBe('proj-a');
    expect(row.label).toBeNull();
    expect(row.metadata).toEqual({});
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('listGcpTargets is project-scoped and sorted by gcpProjectId', async () => {
    await addGcpTarget(db, { ...base, gcpProjectId: 'proj-z' });
    await addGcpTarget(db, { ...base, gcpProjectId: 'proj-a' });
    await addGcpTarget(db, { ...base, projectId: 'other', gcpProjectId: 'proj-x' });
    const list = await listGcpTargets(db, 'p1');
    expect(list.map((t) => t.gcpProjectId)).toEqual(['proj-a', 'proj-z']);
  });

  it('gcpTargetExists by (projectId, gcpProjectId)', async () => {
    await addGcpTarget(db, { ...base, gcpProjectId: 'proj-a' });
    expect(await gcpTargetExists(db, 'p1', 'proj-a')).toBe(true);
    expect(await gcpTargetExists(db, 'p1', 'proj-b')).toBe(false);
    expect(await gcpTargetExists(db, 'other', 'proj-a')).toBe(false);
  });

  it('removeGcpTarget is project-scoped', async () => {
    const row = await addGcpTarget(db, { ...base, gcpProjectId: 'proj-a' });
    expect(await removeGcpTarget(db, 'other', row.id)).toBe(false);
    expect(await removeGcpTarget(db, 'p1', row.id)).toBe(true);
    expect(await gcpTargetExists(db, 'p1', 'proj-a')).toBe(false);
  });

  it('setGcpTargetSignals merges availableSignals into metadata', async () => {
    const row = await addGcpTarget(db, { ...base, gcpProjectId: 'proj-a', metadata: {} });
    await setGcpTargetSignals(db, row.id, ['monitoring', 'logging']);
    const [updated] = await listGcpTargets(db, 'p1');
    expect((updated!.metadata as { availableSignals?: string[] }).availableSignals).toEqual(['monitoring', 'logging']);
    await setGcpTargetSignals(db, 'missing', ['monitoring']); // no throw
  });

  it('toPublicGcpTarget keeps fields + availableSignals', () => {
    const pub = toPublicGcpTarget({
      id: 't1', projectId: 'p1', connectionId: 'c1', gcpProjectId: 'proj-a', label: 'Production',
      metadata: { availableSignals: ['monitoring'] }, addedByUserId: 'u1', createdAt: new Date(),
    });
    expect(pub.gcpProjectId).toBe('proj-a');
    expect(pub.metadata.availableSignals).toEqual(['monitoring']);
  });
});
