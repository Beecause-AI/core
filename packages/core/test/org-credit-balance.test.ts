import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner, getOrgById } from '../src/index.js';
import { col } from '../src/store/collections.js';

const t = testStore('org-credit-balance');
afterAll(() => t.close());

describe('creditBalanceCents default', () => {
  it('is 0 on a freshly created org', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'O', slug: `cb-${randomUUID().slice(0,8)}`, userId: randomUUID() });
    expect(org.creditBalanceCents).toBe(0);
  });
  it('is filled to 0 on read for a legacy doc that lacks it', async () => {
    const ref = col(t.db, 'organizations').doc();
    await ref.set({ id: ref.id, name: 'Legacy', slug: `lg-${randomUUID().slice(0,8)}`, status: 'active', createdAt: new Date() });
    const org = await getOrgById(t.db, ref.id);
    expect(org?.creditBalanceCents).toBe(0);
  });
});
