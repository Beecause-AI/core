import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  createOrgWithOwner, listOrgsForUser, getMembership, createPendingOrg, deleteOrg,
  addOrgOwner, getOrgBySlug, getOrgById, listOrgMembers, setOrgRole, listAllOrgs,
  setOrgBetaTester, setOrgKgEnabled,
} from '../../src/repos/orgs.js';

const store = testStore('orgs');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function seedUser(userId: string, email: string) {
  await col(db, 'users').doc(userId).set(toDoc(applyDefaults({ userId, email, updatedAt: new Date() }, userId)));
}

describe('orgs repo (Firestore)', () => {
  it('createOrgWithOwner creates the org + an owner member', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    expect(org.id).toBeTruthy();
    expect(org.name).toBe('Acme');
    expect(org.slug).toBe('acme');
    expect(org.createdAt).toBeInstanceOf(Date);

    const m = await getMembership(db, org.id, 'u1');
    expect(m?.role).toBe('owner');
    // composite doc id scheme matches project-members.ts / invitations.ts
    const raw = await col(db, 'org_members').doc(`${org.id}_u1`).get();
    expect(raw.exists).toBe(true);
    expect(raw.data()?.['role']).toBe('owner');
  });

  it('getOrgBySlug / getOrgById find by their respective keys, null otherwise', async () => {
    const org = await createOrgWithOwner(db, { name: 'Beta', slug: 'beta', userId: 'u1' });
    expect((await getOrgBySlug(db, 'beta'))?.id).toBe(org.id);
    expect((await getOrgById(db, org.id))?.slug).toBe('beta');
    expect(await getOrgBySlug(db, 'nope')).toBeNull();
    expect(await getOrgById(db, 'nope')).toBeNull();
  });

  it('createPendingOrg reserves a pending slug', async () => {
    const org = await createPendingOrg(db, { name: 'Pend', slug: 'pend', email: 'a@b.com' });
    expect(org.status).toBe('pending');
    expect(org.pendingEmail).toBe('a@b.com');
  });

  it('setOrgRole guard: cannot demote the last owner', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'owner1' });
    // single owner → demotion refused
    expect(await setOrgRole(db, org.id, 'owner1', 'manager')).toBe(false);
    expect((await getMembership(db, org.id, 'owner1'))?.role).toBe('owner');

    // add a second owner → now the first can be demoted
    await addOrgOwner(db, org.id, 'owner2');
    expect(await setOrgRole(db, org.id, 'owner1', 'user')).toBe(true);
    expect((await getMembership(db, org.id, 'owner1'))?.role).toBe('user');

    // promoting to owner is always allowed (no guard)
    expect(await setOrgRole(db, org.id, 'owner1', 'owner')).toBe(true);
    expect((await getMembership(db, org.id, 'owner1'))?.role).toBe('owner');
  });

  it('addOrgOwner is idempotent (onConflictDoNothing)', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    await addOrgOwner(db, org.id, 'u2');
    await addOrgOwner(db, org.id, 'u2'); // no throw, no dup
    const members = await listOrgMembers(db, org.id);
    expect(members.filter((m) => m.userId === 'u2')).toHaveLength(1);
  });

  it('listOrgMembers left-joins email (null when never logged in)', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    await addOrgOwner(db, org.id, 'u2');
    await seedUser('u1', 'u1@example.com');

    const members = await listOrgMembers(db, org.id);
    expect(members).toHaveLength(2);
    const u1 = members.find((m) => m.userId === 'u1');
    const u2 = members.find((m) => m.userId === 'u2');
    expect(u1?.role).toBe('owner');
    expect(u1?.email).toBe('u1@example.com');
    expect(u2?.email).toBeNull();
  });

  it('listOrgsForUser returns every org the user belongs to', async () => {
    const a = await createOrgWithOwner(db, { name: 'A', slug: 'a', userId: 'u1' });
    const b = await createOrgWithOwner(db, { name: 'B', slug: 'b', userId: 'u1' });
    await createOrgWithOwner(db, { name: 'C', slug: 'c', userId: 'other' });

    const orgs = await listOrgsForUser(db, 'u1');
    expect(orgs.map((o) => o.id).sort()).toEqual([a.id, b.id].sort());
    expect(await listOrgsForUser(db, 'nobody')).toEqual([]);
  });

  it('deleteOrg removes the org', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    await deleteOrg(db, org.id);
    expect(await getOrgById(db, org.id)).toBeNull();
  });

  it('listAllOrgs returns member counts, search filter, and a truncation flag', async () => {
    const a = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    await addOrgOwner(db, a.id, 'u2');
    await createOrgWithOwner(db, { name: 'Globex', slug: 'globex', userId: 'u3' });

    const all = await listAllOrgs(db);
    expect(all.orgs).toHaveLength(2);
    expect(all.truncated).toBe(false);
    const acme = all.orgs.find((o) => o.slug === 'acme');
    expect(acme?.memberCount).toBe(2);

    // case-insensitive substring search on name/slug
    const filtered = await listAllOrgs(db, { q: 'ACM' });
    expect(filtered.orgs.map((o) => o.slug)).toEqual(['acme']);

    // limit sentinel → truncated
    const limited = await listAllOrgs(db, { limit: 1 });
    expect(limited.orgs).toHaveLength(1);
    expect(limited.truncated).toBe(true);
  });

  it('setOrgBetaTester / setOrgKgEnabled patch + return the org, null when absent', async () => {
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    expect((await setOrgBetaTester(db, org.id, true))?.betaTester).toBe(true);
    expect((await setOrgKgEnabled(db, org.id, true))?.kgEnabled).toBe(true);
    expect(await setOrgBetaTester(db, 'nope', true)).toBeNull();
  });
});
