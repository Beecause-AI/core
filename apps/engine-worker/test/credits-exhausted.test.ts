import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { testStore } from '../../../packages/core/test/store/emulator.js';
import { createOrgWithOwner } from '@intellilabs/core';
import { addCredits } from '@intellilabs/billing';
import type { QueuedTurn } from '@intellilabs/core';
import { makeCreditsExhausted } from '../src/engine/credits-exhausted.js';

const t = testStore('credits-exhausted');
afterAll(() => t.close());

function turn(orgId: string): QueuedTurn {
  return { id: randomUUID(), laneId: randomUUID(), orgId, source: 'slack' } as unknown as QueuedTurn;
}
async function org(balanceCents: number) {
  const o = await createOrgWithOwner(t.db, { name: 'O', slug: `ce-${randomUUID().slice(0,8)}`, userId: randomUUID() });
  if (balanceCents) await addCredits(t.db, { orgId: o.id, amountCents: balanceCents, kind: 'grant', ledgerId: `g_${o.id}` });
  return o;
}

describe('creditsExhausted predicate', () => {
  it('never blocks when enforcement is off', async () => {
    const o = await org(0);
    expect(await makeCreditsExhausted(t.db, { enforced: false })(turn(o.id))).toBe(false);
  });
  it('does not block when balance is positive', async () => {
    const o = await org(500);
    expect(await makeCreditsExhausted(t.db, { enforced: true })(turn(o.id))).toBe(false);
  });
  it('blocks when enforced and balance <= 0', async () => {
    const o = await org(0);
    expect(await makeCreditsExhausted(t.db, { enforced: true })(turn(o.id))).toBe(true);
  });
});
