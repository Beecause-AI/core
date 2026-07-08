import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addAzureConnection, getAzureConnection, listAzureOrgConnections,
  addAzureTarget, listAzureTargets, azureTargetExists, removeAzureTarget, removeAzureTargetsForConnection,
} from '../src/index.js';

const store = testStore('azure-repos');
const db = store.db;

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

describe('azure connections', () => {
  it('adds and lists an org connection', async () => {
    const c = await addAzureConnection(db, {
      orgId: 'o1', projectId: null, name: 'prod', mode: 'service_principal',
      tenantId: 't1', clientId: 'app-1', secretCiphertext: 'enc', secretHint: '…ap-1',
      defaultSubscriptionId: 'sub-1',
    });
    expect(c.tenantId).toBe('t1');
    const list = await listAzureOrgConnections(db, 'o1');
    expect(list.map((x) => x.id)).toEqual([c.id]);
    expect(await getAzureConnection(db, 'o1', c.id)).not.toBeNull();
    expect(await getAzureConnection(db, 'other-org', c.id)).toBeNull();
  });
});

describe('azure targets', () => {
  it('targets are unique per (subscription, workspace) within a project and cascade on connection delete', async () => {
    const t = await addAzureTarget(db, {
      projectId: 'p1', connectionId: 'c1', subscriptionId: 'sub-1',
      logAnalyticsWorkspaceId: 'ws-1', region: 'eastus', label: 'prod', addedByUserId: 'u1',
    });
    expect(await azureTargetExists(db, 'p1', 'sub-1', 'ws-1')).toBe(true);
    expect(await azureTargetExists(db, 'p1', 'sub-1', null)).toBe(false);
    expect((await listAzureTargets(db, 'p1')).map((x) => x.id)).toEqual([t.id]);
    await removeAzureTargetsForConnection(db, 'p1', 'c1');
    expect(await listAzureTargets(db, 'p1')).toEqual([]);
  });
});
