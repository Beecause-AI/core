import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { getOrgById, getOrgBySlug } from '../src/repos/orgs.js';

const t = testStore('org-billing-read-defaults');
afterAll(() => t.close());

describe('billing defaults on read for legacy org docs', () => {
  it('fills billing defaults when the stored doc predates the fields', async () => {
    const id = randomUUID();
    const slug = `legacy-${id.slice(0, 8)}`;
    // Raw write WITHOUT billing fields — mimics an org created before this branch.
    await t.db.collection('organizations').doc(id).set({ id, name: 'Legacy', slug, plan: 'free', status: 'active', createdAt: new Date() });
    for (const org of [await getOrgById(t.db, id), await getOrgBySlug(t.db, slug)]) {
      expect(org).not.toBeNull();
      expect(org!.billingBand).toBe('indie');
      expect(org!.billingEnabled).toBe(false);
      expect(org!.aiSpendCapUsd).toBeNull();
      expect(org!.stripeCustomerId).toBeNull();
    }
  });
});
