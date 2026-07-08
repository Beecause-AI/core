import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import { upsertUser, findOrgsByEmail } from '../../src/repos/users.js';

const store = testStore('users');
const db = store.db;

async function seedOrg(id: string, slug: string, status: 'active' | 'pending') {
  await col(db, 'organizations').doc(id).set(toDoc(applyDefaults({ id, name: slug, slug, status }, id)));
}
async function seedMember(orgId: string, userId: string) {
  const id = `${orgId}_${userId}`;
  await col(db, 'org_members').doc(id).set(toDoc(applyDefaults({ id, orgId, userId, role: 'user' }, id)));
}

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('users repo (Firestore)', () => {
  it('upserts a user keyed by userId and lowercases email', async () => {
    await upsertUser(db, { userId: 'u1', email: '  Foo@Bar.COM ' });
    const snap = await col(db, 'users').doc('u1').get();
    expect(snap.data()?.email).toBe('foo@bar.com');
  });

  it('findOrgsByEmail returns active orgs across multiple userIds, sorted by slug, deduped', async () => {
    await seedOrg('o1', 'alpha', 'active');
    await seedOrg('o2', 'bravo', 'active');
    await seedOrg('o3', 'charlie', 'pending'); // excluded (not active)
    // two userIds, same email, overlapping + distinct orgs
    await upsertUser(db, { userId: 'u1', email: 'p@x.com' });
    await upsertUser(db, { userId: 'u2', email: 'p@x.com' });
    await seedMember('o1', 'u1');
    await seedMember('o2', 'u1');
    await seedMember('o2', 'u2'); // duplicate org via second user
    await seedMember('o3', 'u1'); // pending → filtered out

    const orgs = await findOrgsByEmail(db, 'P@X.com');
    expect(orgs.map((o) => o.slug)).toEqual(['alpha', 'bravo']);
  });

  it('returns [] when the email is unknown', async () => {
    expect(await findOrgsByEmail(db, 'nobody@x.com')).toEqual([]);
  });
});
