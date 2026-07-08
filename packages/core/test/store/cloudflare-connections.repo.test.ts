import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  addConnection, getConnection, updateConnection, deleteConnection,
  listConnectionsForProject, listOrgConnections, toPublicCloudflareConnection,
} from '../../src/repos/cloudflare-connections.js';

const store = testStore('cloudflare-connections');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('cloudflare-connections repo (Firestore)', () => {
  it('addConnection returns a row with id and defaults', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'Prod', mode: 'api_token', secretCiphertext: 'CIPHER' });
    expect(row.id).toBeTruthy();
    expect(row.orgId).toBe('o1');
    expect(row.projectId).toBeNull();
    expect(row.enabled).toBe(true);
    expect(row.metadata).toEqual({});
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it('getConnection scopes by org', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'api_token', secretCiphertext: 'C' });
    expect((await getConnection(db, 'o1', row.id))?.id).toBe(row.id);
    expect(await getConnection(db, 'other', row.id)).toBeNull();
  });

  it('listConnectionsForProject returns org-shared + project-owned, sorted by name', async () => {
    await addConnection(db, { orgId: 'o1', projectId: null, name: 'Zeta', mode: 'api_token', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'p1', name: 'Alpha', mode: 'api_token', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'other', name: 'Other', mode: 'api_token', secretCiphertext: 'C' });
    const list = await listConnectionsForProject(db, 'o1', 'p1');
    expect(list.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
  });

  it('listOrgConnections returns only org-shared', async () => {
    await addConnection(db, { orgId: 'o1', projectId: null, name: 'Shared', mode: 'api_token', secretCiphertext: 'C' });
    await addConnection(db, { orgId: 'o1', projectId: 'p1', name: 'Owned', mode: 'api_token', secretCiphertext: 'C' });
    expect((await listOrgConnections(db, 'o1')).map((c) => c.name)).toEqual(['Shared']);
  });

  it('updateConnection patches; org-scoped', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'api_token', secretCiphertext: 'C' });
    expect(await updateConnection(db, 'o1', row.id, { name: 'P2' })).toBe(true);
    expect((await getConnection(db, 'o1', row.id))?.name).toBe('P2');
    expect(await updateConnection(db, 'other', row.id, { name: 'X' })).toBe(false);
  });

  it('deleteConnection removes the row; org-scoped', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'api_token', secretCiphertext: 'C' });
    expect(await deleteConnection(db, 'other', row.id)).toBe(false);
    expect(await deleteConnection(db, 'o1', row.id)).toBe(true);
    expect(await getConnection(db, 'o1', row.id)).toBeNull();
  });

  it('toPublicCloudflareConnection strips ciphertext', async () => {
    const row = await addConnection(db, { orgId: 'o1', name: 'P', mode: 'api_token', secretCiphertext: 'SECRET', metadata: { accountId: 'acc' } });
    const pub = toPublicCloudflareConnection(row);
    expect('secretCiphertext' in pub).toBe(false);
    expect(pub.metadata.accountId).toBe('acc');
  });
});
