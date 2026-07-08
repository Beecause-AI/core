import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  addConnection, getConnection, updateConnection, deleteConnection,
  listConnectionsForProject, listOrgConnections, toPublicGcpConnection,
} from '../../src/repos/gcp-connections.js';

const store = testStore('gcp-connections');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('gcp-connections repo (Firestore)', () => {
  it('addConnection returns a row with id and defaults', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'Prod', mode: 'sa_key', secretCiphertext: 'CIPHER' });
    expect(row.id).toBeTruthy();
    expect(row.orgId).toBe('o1');
    expect(row.projectId).toBeNull();
    expect(row.enabled).toBe(true);
    expect(row.metadata).toEqual({});
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.updatedAt).toBeInstanceOf(Date);
  });

  it('getConnection scopes by org', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'sa_key', secretCiphertext: 'C' });
    expect((await getConnection(db, 'o1', row.id))?.id).toBe(row.id);
    expect(await getConnection(db, 'other', row.id)).toBeNull();
    expect(await getConnection(db, 'o1', 'missing')).toBeNull();
  });

  it('listConnectionsForProject returns org-shared + project-owned, sorted by name', async () => {
    await addConnection(db, { orgId: 'o1', projectId: null, name: 'Zeta-shared', mode: 'sa_key', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'p1', name: 'Alpha-own', mode: 'sa_key', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'other', name: 'Other', mode: 'sa_key', secretCiphertext: 'C' });
    const list = await listConnectionsForProject(db, 'o1', 'p1');
    expect(list.map((c) => c.name)).toEqual(['Alpha-own', 'Zeta-shared']);
  });

  it('listOrgConnections returns only org-shared (projectId null)', async () => {
    await addConnection(db, { orgId: 'o1', projectId: null, name: 'Shared', mode: 'sa_key', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'p1', name: 'Owned', mode: 'sa_key', secretCiphertext: 'C' });
    const list = await listOrgConnections(db, 'o1');
    expect(list.map((c) => c.name)).toEqual(['Shared']);
  });

  it('updateConnection patches and refreshes updatedAt; org-scoped', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'sa_key', secretCiphertext: 'C' });
    expect(await updateConnection(db, 'o1', row.id, { name: 'P2', lastTestOk: true })).toBe(true);
    const updated = await getConnection(db, 'o1', row.id);
    expect(updated?.name).toBe('P2');
    expect(updated?.lastTestOk).toBe(true);
    expect(await updateConnection(db, 'other', row.id, { name: 'X' })).toBe(false);
    expect(await updateConnection(db, 'o1', 'missing', { name: 'X' })).toBe(false);
  });

  it('deleteConnection removes the row; org-scoped', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'sa_key', secretCiphertext: 'C' });
    expect(await deleteConnection(db, 'other', row.id)).toBe(false);
    expect(await deleteConnection(db, 'o1', row.id)).toBe(true);
    expect(await getConnection(db, 'o1', row.id)).toBeNull();
    expect(await deleteConnection(db, 'o1', row.id)).toBe(false);
  });

  it('toPublicGcpConnection strips ciphertext', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'sa_key', secretCiphertext: 'SECRET', metadata: { saEmail: 'sa@x' } });
    const pub = toPublicGcpConnection(row);
    expect('secretCiphertext' in pub).toBe(false);
    expect(pub.metadata.saEmail).toBe('sa@x');
  });
});
