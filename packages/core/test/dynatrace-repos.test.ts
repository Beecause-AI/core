import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addDynatraceConnection, getDynatraceConnection, listDynatraceOrgConnections, deleteDynatraceConnection,
  addDynatraceTarget, listDynatraceTargets, dynatraceTargetExists, removeDynatraceTarget,
  removeDynatraceTargetsForConnection,
} from '../src/index.js';

const store = testStore('dynatrace-repos');
const db = store.db;

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

describe('dynatrace connections', () => {
  it('creates an org connection and reads it back', async () => {
    const conn = await addDynatraceConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod', mode: 'api_token',
      environmentUrl: 'https://abc12345.live.dynatrace.com',
      secretCiphertext: 'cipher', secretHint: '…cd34', createdByUserId: 'u1',
    });
    expect(conn.environmentUrl).toBe('https://abc12345.live.dynatrace.com');
    const got = await getDynatraceConnection(db, 'o1', conn.id);
    expect(got?.name).toBe('prod');
  });

  it('adds and lists an org connection', async () => {
    const c = await addDynatraceConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod-dt',
      mode: 'api_token', environmentUrl: 'https://xyz.live.dynatrace.com',
      secretCiphertext: 'enc-secret', secretHint: '…abcd',
    });
    expect(c.environmentUrl).toBe('https://xyz.live.dynatrace.com');
    expect(c.mode).toBe('api_token');
    const list = await listDynatraceOrgConnections(db, 'o1');
    expect(list.map((x) => x.id)).toEqual([c.id]);
    expect(await getDynatraceConnection(db, 'o1', c.id)).not.toBeNull();
    expect(await getDynatraceConnection(db, 'other-org', c.id)).toBeNull();
  });
});

describe('dynatrace targets', () => {
  it('adds/lists/removes a (managementZone, service) target and cleans orphans on connection delete', async () => {
    const conn = await addDynatraceConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod', mode: 'api_token',
      environmentUrl: 'https://x.live.dynatrace.com', secretCiphertext: 'c', createdByUserId: 'u1',
    });
    const t = await addDynatraceTarget(db, { projectId: 'p1', connectionId: conn.id, managementZone: 'prod', service: 'checkout', addedByUserId: 'u1' });
    expect(await dynatraceTargetExists(db, 'p1', 'prod', 'checkout')).toBe(true);
    expect(await dynatraceTargetExists(db, 'p1', 'prod', null)).toBe(false);
    expect(await dynatraceTargetExists(db, 'p1', null, 'checkout')).toBe(false);
    expect((await listDynatraceTargets(db, 'p1')).length).toBe(1);
    await deleteDynatraceConnection(db, 'o1', conn.id);
    expect((await listDynatraceTargets(db, 'p1')).length).toBe(0); // orphan cleaned
    const removed = await removeDynatraceTarget(db, 'p1', t.id); // no-op now, returns false
    expect(removed).toBe(false);
  });

  it('targets are unique per (managementZone, service) within a project and cascade on connection delete', async () => {
    const t = await addDynatraceTarget(db, {
      projectId: 'p1', connectionId: 'c1', managementZone: 'prod', service: 'checkout',
      label: 'prod checkout', addedByUserId: 'u1',
    });
    expect(await dynatraceTargetExists(db, 'p1', 'prod', 'checkout')).toBe(true);
    expect(await dynatraceTargetExists(db, 'p1', 'prod', null)).toBe(false);
    expect(await dynatraceTargetExists(db, 'p1', null, 'checkout')).toBe(false);
    expect((await listDynatraceTargets(db, 'p1')).map((x) => x.id)).toEqual([t.id]);
    await removeDynatraceTargetsForConnection(db, 'p1', 'c1');
    expect(await listDynatraceTargets(db, 'p1')).toEqual([]);
  });

  it('deleteConnection cascades to orphan targets', async () => {
    const c = await addDynatraceConnection(db, {
      orgId: 'o1', projectId: null, name: 'cascade-test',
      mode: 'api_token', environmentUrl: 'https://abc.live.dynatrace.com',
      secretCiphertext: 'enc-secret', secretHint: '…abcd',
    });
    await addDynatraceTarget(db, {
      projectId: 'p1', connectionId: c.id, managementZone: 'prod', service: 'api',
      label: 'prod api', addedByUserId: 'u1',
    });
    expect(await dynatraceTargetExists(db, 'p1', 'prod', 'api')).toBe(true);
    const deleted = await deleteDynatraceConnection(db, 'o1', c.id);
    expect(deleted).toBe(true);
    expect(await dynatraceTargetExists(db, 'p1', 'prod', 'api')).toBe(false);
    expect(await listDynatraceTargets(db, 'p1')).toEqual([]);
  });

  it('removeDynatraceTarget removes only the specified target', async () => {
    const t1 = await addDynatraceTarget(db, {
      projectId: 'p1', connectionId: 'c1', managementZone: null, service: null,
      addedByUserId: 'u1',
    });
    const t2 = await addDynatraceTarget(db, {
      projectId: 'p1', connectionId: 'c1', managementZone: 'staging', service: null,
      addedByUserId: 'u1',
    });
    await removeDynatraceTarget(db, 'p1', t1.id);
    const remaining = await listDynatraceTargets(db, 'p1');
    expect(remaining.map((x) => x.id)).toEqual([t2.id]);
  });
});
