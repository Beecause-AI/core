import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  acceptInvitation, createInvitation, getInvitation, listPendingInvitations, revokeInvitation,
} from '../../src/repos/invitations.js';

const store = testStore('invitations');
const db = store.db;

const orgId = 'org-inv';
const inWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

async function membership(org: string, userId: string) {
  const snap = await col(db, 'org_members').doc(`${org}_${userId}`).get();
  return snap.exists ? { role: snap.data()?.['role'] as string } : null;
}

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('invitations repo (Firestore)', () => {
  it('creates a pending invitation with a lowercased email', async () => {
    const inv = await createInvitation(db, { orgId, email: ' Alice@Example.COM ', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(inv.status).toBe('pending');
    expect(inv.email).toBe('alice@example.com');
    expect((await listPendingInvitations(db, orgId)).map((i) => i.id)).toContain(inv.id);
  });

  it('rejects a duplicate pending invite for the same email', async () => {
    await createInvitation(db, { orgId, email: 'dup@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    await expect(
      createInvitation(db, { orgId, email: 'dup@example.com', role: 'manager', invitedBy: 'kc-owner', expiresAt: inWeek() }),
    ).rejects.toThrow();
  });

  it('revoke clears the pending slot so the email can be re-invited', async () => {
    const inv = await createInvitation(db, { orgId, email: 'revoke@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(await revokeInvitation(db, orgId, inv.id)).toBe(true);
    expect(await revokeInvitation(db, orgId, inv.id)).toBe(false); // already revoked
    const again = await createInvitation(db, { orgId, email: 'revoke@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(again.status).toBe('pending');
  });

  it('revoke is org-scoped', async () => {
    const inv = await createInvitation(db, { orgId, email: 'scoped@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(await revokeInvitation(db, 'some-other-org', inv.id)).toBe(false);
    expect(await revokeInvitation(db, orgId, inv.id)).toBe(true);
  });

  it('accept adds the member at the invited role and marks the row accepted', async () => {
    const inv = await createInvitation(db, { orgId, email: 'bob@example.com', role: 'manager', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(await acceptInvitation(db, inv.id, 'kc-bob')).toBe(true);
    expect((await membership(orgId, 'kc-bob'))?.role).toBe('manager');
    expect((await getInvitation(db, inv.id))?.status).toBe('accepted');
    // second redemption is a no-op
    expect(await acceptInvitation(db, inv.id, 'kc-bob')).toBe(false);
  });

  it('accept keeps the existing role for someone who is already a member', async () => {
    await acceptInvitation(db, (await createInvitation(db, { orgId, email: 'mgr@example.com', role: 'manager', invitedBy: 'kc-owner', expiresAt: inWeek() })).id, 'kc-already');
    const userInv = await createInvitation(db, { orgId, email: 'user2@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    expect(await acceptInvitation(db, userInv.id, 'kc-already')).toBe(true);
    // 'user' invite must not demote the existing manager
    expect((await membership(orgId, 'kc-already'))?.role).toBe('manager');
  });

  it('refuses an expired invitation and leaves it pending', async () => {
    const inv = await createInvitation(db, { orgId, email: 'late@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: new Date(Date.now() - 1000) });
    expect(await acceptInvitation(db, inv.id, 'kc-late')).toBe(false);
    expect(await membership(orgId, 'kc-late')).toBeNull();
    expect((await getInvitation(db, inv.id))?.status).toBe('pending');
  });

  it('refuses a revoked invitation', async () => {
    const inv = await createInvitation(db, { orgId, email: 'gone@example.com', role: 'user', invitedBy: 'kc-owner', expiresAt: inWeek() });
    await revokeInvitation(db, orgId, inv.id);
    expect(await acceptInvitation(db, inv.id, 'kc-gone')).toBe(false);
    expect(await membership(orgId, 'kc-gone')).toBeNull();
  });

  it('refuses a missing invitation', async () => {
    expect(await acceptInvitation(db, 'no-such-id', 'kc-x')).toBe(false);
  });
});
