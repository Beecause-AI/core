import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './store/emulator.js';
import {
  addGrafanaConnection, listGrafanaOrgConnections, listGrafanaConnectionsForProject, getGrafanaConnection,
  addGrafanaTarget, listGrafanaTargets, grafanaTargetExists, removeGrafanaTarget,
  getGrafanaProjectConnection, setGrafanaProjectConnection, deleteGrafanaProjectConnection,
  toPublicGrafanaConnection,
} from '../src/index.js';

const store = testStore('grafana-repos');
const db = store.db;
const orgId = 'org-1';
const projectId = 'proj-1';

beforeEach(async () => { await wipe(db); });
afterAll(() => store.close());

const mk = (over: Record<string, unknown> = {}) => ({
  orgId, name: 'Prod', mode: 'grafana' as const, baseUrl: 'https://grafana.acme.io',
  secretCiphertext: 'ct', secretHint: '…oken', createdByUserId: 'u1', ...over,
});

describe('grafana connections', () => {
  it('lists org-shared but not project-owned in listOrgConnections', async () => {
    const shared = await addGrafanaConnection(db, mk({ projectId: null, name: 'Shared' }));
    await addGrafanaConnection(db, mk({ projectId, name: 'Owned' }));
    const org = await listGrafanaOrgConnections(db, orgId);
    expect(org.map((c) => c.id)).toEqual([shared.id]);
  });

  it('merges org-shared + project-owned in listConnectionsForProject', async () => {
    const shared = await addGrafanaConnection(db, mk({ projectId: null, name: 'Shared' }));
    const owned = await addGrafanaConnection(db, mk({ projectId, name: 'Owned' }));
    const visible = await listGrafanaConnectionsForProject(db, orgId, projectId);
    expect(new Set(visible.map((c) => c.id))).toEqual(new Set([shared.id, owned.id]));
  });

  it('strips the secret in toPublicGrafanaConnection', async () => {
    const row = await addGrafanaConnection(db, mk());
    const pub = toPublicGrafanaConnection(row);
    expect('secretCiphertext' in pub).toBe(false);
    expect(pub.metadata).toEqual({});
  });

  it('scopes getGrafanaConnection by org', async () => {
    const row = await addGrafanaConnection(db, mk());
    expect(await getGrafanaConnection(db, orgId, row.id)).not.toBeNull();
    expect(await getGrafanaConnection(db, 'other-org', row.id)).toBeNull();
  });
});

describe('grafana targets', () => {
  it('adds, lists, dedupes by uid, and removes', async () => {
    await addGrafanaTarget(db, { projectId, connectionId: 'c1', datasourceUid: 'ds-prom', datasourceType: 'prometheus', name: 'Prom', addedByUserId: 'u1' });
    expect(await grafanaTargetExists(db, projectId, 'ds-prom')).toBe(true);
    expect(await grafanaTargetExists(db, projectId, 'ds-other')).toBe(false);
    const list = await listGrafanaTargets(db, projectId);
    expect(list).toHaveLength(1);
    expect(await removeGrafanaTarget(db, projectId, list[0]!.id)).toBe(true);
    expect(await listGrafanaTargets(db, projectId)).toHaveLength(0);
  });
});

describe('grafana project binding', () => {
  it('sets, reads, and deletes the binding', async () => {
    await setGrafanaProjectConnection(db, { orgId, projectId, connectionId: 'c1', userId: 'u1' });
    expect((await getGrafanaProjectConnection(db, projectId))?.connectionId).toBe('c1');
    await setGrafanaProjectConnection(db, { orgId, projectId, connectionId: 'c2', userId: 'u1' });
    expect((await getGrafanaProjectConnection(db, projectId))?.connectionId).toBe('c2');
    expect(await deleteGrafanaProjectConnection(db, projectId)).toBe(true);
    expect(await getGrafanaProjectConnection(db, projectId)).toBeNull();
  });
});
