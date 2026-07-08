import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  getProjectRole, listProjectMembers, addProjectMember,
  setProjectRole, removeProjectMember, userIdByEmail,
} from '../../src/repos/project-members.js';

const store = testStore('project-members');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function seedUser(userId: string, email: string) {
  await col(db, 'users').doc(userId).set(toDoc(applyDefaults({ userId, email, updatedAt: new Date() }, userId)));
}

describe('project-members repo (Firestore)', () => {
  it('addProjectMember adds project_members AND ensures org_members', async () => {
    await addProjectMember(db, 'o1', 'p1', 'new-user', 'user');
    expect(await getProjectRole(db, 'p1', 'new-user')).toBe('user');
    const om = await col(db, 'org_members').doc('o1_new-user').get();
    expect(om.exists).toBe(true);
    expect(om.data()?.['role']).toBe('user');
  });

  it('addProjectMember upserts role on conflict, keeps existing org membership', async () => {
    const orgId = 'o1';
    await col(db, 'org_members').doc(`${orgId}_u`).set(toDoc(applyDefaults({ orgId, userId: 'u', role: 'owner' }, `${orgId}_u`)));
    await addProjectMember(db, orgId, 'p1', 'u', 'user');
    await addProjectMember(db, orgId, 'p1', 'u', 'admin');
    expect(await getProjectRole(db, 'p1', 'u')).toBe('admin');
    // org membership not downgraded from owner
    expect((await col(db, 'org_members').doc(`${orgId}_u`).get()).data()?.['role']).toBe('owner');
  });

  it('getProjectRole returns role or null', async () => {
    await addProjectMember(db, 'o1', 'p1', 'role-user', 'admin');
    expect(await getProjectRole(db, 'p1', 'role-user')).toBe('admin');
    expect(await getProjectRole(db, 'p1', 'no-such')).toBeNull();
  });

  it('setProjectRole updates the role', async () => {
    await addProjectMember(db, 'o1', 'p1', 'sr', 'user');
    await setProjectRole(db, 'p1', 'sr', 'admin');
    expect(await getProjectRole(db, 'p1', 'sr')).toBe('admin');
  });

  it('removeProjectMember removes the row', async () => {
    await addProjectMember(db, 'o1', 'p1', 'rem', 'user');
    await removeProjectMember(db, 'p1', 'rem');
    expect(await getProjectRole(db, 'p1', 'rem')).toBeNull();
  });

  it('listProjectMembers left-joins email (null when never logged in)', async () => {
    await addProjectMember(db, 'o1', 'p1', 'u1', 'admin');
    await addProjectMember(db, 'o1', 'p1', 'u2', 'user');
    await seedUser('u1', 'u1@example.com');

    const members = await listProjectMembers(db, 'p1');
    expect(members).toHaveLength(2);
    const u1 = members.find((m) => m.userId === 'u1');
    const u2 = members.find((m) => m.userId === 'u2');
    expect(u1?.role).toBe('admin');
    expect(u1?.email).toBe('u1@example.com');
    expect(u2?.role).toBe('user');
    expect(u2?.email).toBeNull();
  });

  it('userIdByEmail resolves a known (lowercased) email', async () => {
    await seedUser('uid-1', 'test@example.com');
    expect(await userIdByEmail(db, 'TEST@example.com')).toBe('uid-1');
    expect(await userIdByEmail(db, 'nobody@example.com')).toBeNull();
  });
});
