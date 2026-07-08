import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  getProjectConnection, setProjectConnection, deleteProjectConnection,
} from '../../src/repos/gcp-project-connections.js';

const store = testStore('gcp-project-connections');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('gcp-project-connections repo (Firestore)', () => {
  it('getProjectConnection returns null when unset', async () => {
    expect(await getProjectConnection(db, 'p1')).toBeNull();
  });

  it('setProjectConnection creates then upserts (one binding per project)', async () => {
    const created = await setProjectConnection(db, { orgId: 'o1', projectId: 'p1', connectionId: 'c1', userId: 'u1' });
    expect(created.connectionId).toBe('c1');
    expect(created.orgId).toBe('o1');
    expect(created.createdAt).toBeInstanceOf(Date);

    const updated = await setProjectConnection(db, { orgId: 'o1', projectId: 'p1', connectionId: 'c2' });
    expect(updated.connectionId).toBe('c2');
    // still a single binding for the project
    const got = await getProjectConnection(db, 'p1');
    expect(got?.connectionId).toBe('c2');
    // createdAt preserved across the conflict update
    expect(got?.createdAt.getTime()).toBe(created.createdAt.getTime());
  });

  it('deleteProjectConnection removes the binding', async () => {
    await setProjectConnection(db, { orgId: 'o1', projectId: 'p1', connectionId: 'c1' });
    expect(await deleteProjectConnection(db, 'p1')).toBe(true);
    expect(await getProjectConnection(db, 'p1')).toBeNull();
    expect(await deleteProjectConnection(db, 'p1')).toBe(false);
  });
});
