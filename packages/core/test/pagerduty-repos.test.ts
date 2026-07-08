import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addConnection, getConnection, listConnectionsForProject, listOrgConnections,
  updateConnection, deleteConnection, toPublicPagerDutyConnection,
} from '../src/repos/pagerduty-connections.js';
import {
  addPagerDutyTarget, listPagerDutyTargets, pagerdutyTargetExists,
  removePagerDutyTarget, removePagerDutyTargetsForConnection,
} from '../src/repos/pagerduty-targets.js';

const store = testStore('pagerduty-repos');
const db = store.db;

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

const base = { orgId: 'o1', name: 'Prod', mode: 'api_keys' as const, region: 'us', secretCiphertext: 'x', secretHint: '…1234' };

describe('pagerduty connections repo', () => {
  it('adds + reads back an org-shared connection (region persisted, secret stripped in public)', async () => {
    const row = await addConnection(db, { ...base, projectId: null });
    const got = await getConnection(db, 'o1', row.id);
    expect(got?.region).toBe('us');
    expect((toPublicPagerDutyConnection(row) as any).secretCiphertext).toBeUndefined();
  });

  it('listConnectionsForProject returns org-shared + project-own', async () => {
    await addConnection(db, { ...base, projectId: null });
    await addConnection(db, { ...base, name: 'Proj', projectId: 'p1' });
    const rows = await listConnectionsForProject(db, 'o1', 'p1');
    expect(rows.map((r) => r.name).sort()).toEqual(['Prod', 'Proj']);
    const orgOnly = await listOrgConnections(db, 'o1');
    expect(orgOnly.map((r) => r.name)).toEqual(['Prod']);
  });

  it('updates and deletes', async () => {
    const row = await addConnection(db, { ...base, projectId: null });
    await updateConnection(db, 'o1', row.id, { enabled: false });
    expect((await getConnection(db, 'o1', row.id))?.enabled).toBe(false);
    expect(await deleteConnection(db, 'o1', row.id)).toBe(true);
    expect(await getConnection(db, 'o1', row.id)).toBeNull();
  });
});

describe('pagerduty targets repo', () => {
  it('adds, lists, dedup-checks, and removes a (team, service) target', async () => {
    const t = await addPagerDutyTarget(db, {
      projectId: 'p1', connectionId: 'c1', teamId: 'T1', teamName: 'Payments',
      serviceId: 'S1', serviceName: 'checkout', addedByUserId: 'u1',
    });
    expect(await pagerdutyTargetExists(db, 'p1', 'T1', 'S1')).toBe(true);
    expect((await listPagerDutyTargets(db, 'p1')).length).toBe(1);
    expect(await removePagerDutyTarget(db, 'p1', t.id)).toBe(true);
    expect((await listPagerDutyTargets(db, 'p1')).length).toBe(0);
  });

  it('removes all targets for a connection', async () => {
    await addPagerDutyTarget(db, { projectId: 'p1', connectionId: 'c9', serviceId: 'S1', addedByUserId: 'u1' });
    await addPagerDutyTarget(db, { projectId: 'p1', connectionId: 'c9', serviceId: 'S2', addedByUserId: 'u1' });
    await removePagerDutyTargetsForConnection(db, 'p1', 'c9');
    expect((await listPagerDutyTargets(db, 'p1')).length).toBe(0);
  });
});
