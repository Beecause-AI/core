import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addDatadogConnection, getDatadogConnection, listDatadogOrgConnections, deleteDatadogConnection,
  addDatadogTarget, listDatadogTargets, datadogTargetExists, removeDatadogTarget,
  removeDatadogTargetsForConnection,
} from '../src/index.js';

const store = testStore('datadog-repos');
const db = store.db;

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

describe('datadog connections', () => {
  it('adds and lists an org connection', async () => {
    const c = await addDatadogConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod-dd',
      mode: 'api_keys', site: 'us1',
      secretCiphertext: 'enc-secret', secretHint: '…abcd',
    });
    expect(c.site).toBe('us1');
    expect(c.mode).toBe('api_keys');
    const list = await listDatadogOrgConnections(db, 'o1');
    expect(list.map((x) => x.id)).toEqual([c.id]);
    expect(await getDatadogConnection(db, 'o1', c.id)).not.toBeNull();
    expect(await getDatadogConnection(db, 'other-org', c.id)).toBeNull();
  });
});

describe('datadog targets', () => {
  it('targets are unique per (env, service) within a project and cascade on connection delete', async () => {
    const t = await addDatadogTarget(db, {
      projectId: 'p1', connectionId: 'c1', env: 'prod', service: 'checkout',
      label: 'prod checkout', addedByUserId: 'u1',
    });
    expect(await datadogTargetExists(db, 'p1', 'prod', 'checkout')).toBe(true);
    expect(await datadogTargetExists(db, 'p1', 'prod', null)).toBe(false);
    expect(await datadogTargetExists(db, 'p1', 'staging', 'checkout')).toBe(false);
    expect((await listDatadogTargets(db, 'p1')).map((x) => x.id)).toEqual([t.id]);
    await removeDatadogTargetsForConnection(db, 'p1', 'c1');
    expect(await listDatadogTargets(db, 'p1')).toEqual([]);
  });

  it('deleteConnection cascades to orphan targets', async () => {
    const c = await addDatadogConnection(db, {
      orgId: 'o1', projectId: null, name: 'cascade-test',
      mode: 'api_keys', site: 'us1',
      secretCiphertext: 'enc-secret', secretHint: '…abcd',
    });
    await addDatadogTarget(db, {
      projectId: 'p1', connectionId: c.id, env: 'prod', service: 'api',
      label: 'prod api', addedByUserId: 'u1',
    });
    expect(await datadogTargetExists(db, 'p1', 'prod', 'api')).toBe(true);
    const deleted = await deleteDatadogConnection(db, 'o1', c.id);
    expect(deleted).toBe(true);
    expect(await datadogTargetExists(db, 'p1', 'prod', 'api')).toBe(false);
    expect(await listDatadogTargets(db, 'p1')).toEqual([]);
  });

  it('removeDatadogTarget removes only the specified target', async () => {
    const t1 = await addDatadogTarget(db, {
      projectId: 'p1', connectionId: 'c1', env: 'prod', service: null,
      addedByUserId: 'u1',
    });
    const t2 = await addDatadogTarget(db, {
      projectId: 'p1', connectionId: 'c1', env: 'staging', service: null,
      addedByUserId: 'u1',
    });
    await removeDatadogTarget(db, 'p1', t1.id);
    const remaining = await listDatadogTargets(db, 'p1');
    expect(remaining.map((x) => x.id)).toEqual([t2.id]);
  });
});
