import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from '../../../packages/core/test/store/emulator.js';
import { createOrgWithOwner } from '@intellilabs/core';
import { addCredits, getCreditBalanceCents, listCreditLedger } from '@intellilabs/billing';

const t = testStore('credits-read');
afterAll(() => t.close());

describe('credits read surface', () => {
  it('exposes balance + ledger for an org', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'O', slug: `rd-${randomUUID().slice(0,8)}`, userId: randomUUID() });
    await addCredits(t.db, { orgId: org.id, amountCents: 2500, kind: 'purchase', ledgerId: 'topup_pi_read' });
    expect(await getCreditBalanceCents(t.db, org.id)).toBe(2500);
    const ledger = await listCreditLedger(t.db, org.id, 5);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.amountCents).toBe(2500);
  });
});
