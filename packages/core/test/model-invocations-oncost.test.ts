/**
 * Verifies the injected onCost hook contract on recordModelInvocation and
 * finishModelInvocation after billing was decoupled from core.
 *
 * Requires the Firestore emulator on :8080 (FIRESTORE_EMULATOR_HOST env or default).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner } from '../src/index.js';
import { recordModelInvocation, startModelInvocation, finishModelInvocation } from '../src/repos/model-invocations.js';
import type { InvocationCostHook } from '../src/ports/billing-hook.js';

const t = testStore('oncost-hook');
afterAll(() => t.close());

// ── helpers ──────────────────────────────────────────────────────────────────

function makeSpy(): InvocationCostHook & { mock: ReturnType<typeof vi.fn>['mock'] } {
  const fn = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
  return fn as unknown as InvocationCostHook & { mock: ReturnType<typeof vi.fn>['mock'] };
}

async function seedOrg() {
  return createOrgWithOwner(t.db, {
    name: 'OnCostOrg',
    slug: `oc-${randomUUID().slice(0, 8)}`,
    userId: randomUUID(),
  });
}

// ── finishModelInvocation ────────────────────────────────────────────────────

describe('finishModelInvocation — onCost hook', () => {
  it('calls onCost once with correct args when cost > 0 and orgId+conversationId present', async () => {
    const org = await seedOrg();
    const convId = `c-${randomUUID()}`;
    const invId = await startModelInvocation(t.db, {
      source: 'conversation', orgId: org.id, conversationId: convId, model: 'gemini-2.5-flash',
    });
    expect(invId).not.toBeNull();

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await finishModelInvocation(t.db, invId!, { costUsd: '0.02', status: 'ok' }, { onCost: spy as InvocationCostHook });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy).toHaveBeenCalledWith({
      orgId: org.id,
      costUsd: 0.02,
      conversationId: convId,
      modelInvocationId: invId,
    });
  });

  it('does NOT call onCost when cost is 0', async () => {
    const org = await seedOrg();
    const convId = `c-${randomUUID()}`;
    const invId = await startModelInvocation(t.db, {
      source: 'conversation', orgId: org.id, conversationId: convId, model: 'gemini-2.5-flash',
    });

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await finishModelInvocation(t.db, invId!, { costUsd: '0', status: 'ok' }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when cost is null/absent', async () => {
    const org = await seedOrg();
    const convId = `c-${randomUUID()}`;
    const invId = await startModelInvocation(t.db, {
      source: 'conversation', orgId: org.id, conversationId: convId, model: 'gemini-2.5-flash',
    });

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await finishModelInvocation(t.db, invId!, { status: 'ok' }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when conversationId is absent on the row', async () => {
    const org = await seedOrg();
    // No conversationId = background invocation.
    const invId = await startModelInvocation(t.db, {
      source: 'structure', orgId: org.id, conversationId: null, model: 'gemini-2.5-flash',
    });

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await finishModelInvocation(t.db, invId!, { costUsd: '0.05', status: 'ok' }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when orgId is absent on the row', async () => {
    // No orgId (anonymous/background).
    const invId = await startModelInvocation(t.db, {
      source: 'conversation', orgId: null, conversationId: `c-${randomUUID()}`, model: 'gemini-2.5-flash',
    });

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await finishModelInvocation(t.db, invId!, { costUsd: '0.05', status: 'ok' }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when no hook is passed', async () => {
    const org = await seedOrg();
    const convId = `c-${randomUUID()}`;
    const invId = await startModelInvocation(t.db, {
      source: 'conversation', orgId: org.id, conversationId: convId, model: 'gemini-2.5-flash',
    });

    // No error, no crash — just silently skips billing.
    await expect(finishModelInvocation(t.db, invId!, { costUsd: '0.02', status: 'ok' })).resolves.toBeUndefined();
  });
});

// ── recordModelInvocation ────────────────────────────────────────────────────

describe('recordModelInvocation — onCost hook', () => {
  it('calls onCost once with correct args for a costed conversation row', async () => {
    const org = await seedOrg();
    const convId = `c-${randomUUID()}`;

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await recordModelInvocation(t.db, {
      orgId: org.id,
      source: 'conversation',
      model: 'gemini-2.5-flash',
      conversationId: convId,
      costUsd: '0.07',
      status: 'ok',
    }, { onCost: spy as InvocationCostHook });

    expect(spy).toHaveBeenCalledOnce();
    const call = spy.mock.calls[0]![0]!;
    expect(call.orgId).toBe(org.id);
    expect(call.costUsd).toBeCloseTo(0.07);
    expect(call.conversationId).toBe(convId);
    expect(typeof call.modelInvocationId).toBe('string');
    expect(call.modelInvocationId.length).toBeGreaterThan(0);
  });

  it('does NOT call onCost when conversationId is null (background call)', async () => {
    const org = await seedOrg();

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await recordModelInvocation(t.db, {
      orgId: org.id,
      source: 'structure',
      model: 'gemini-2.5-flash',
      conversationId: null,
      costUsd: '0.10',
      status: 'ok',
    }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when costUsd is null', async () => {
    const org = await seedOrg();

    const spy = vi.fn(async (_args: Parameters<InvocationCostHook>[0]): Promise<void> => {});
    await recordModelInvocation(t.db, {
      orgId: org.id,
      source: 'conversation',
      model: 'gemini-2.5-flash',
      conversationId: `c-${randomUUID()}`,
      costUsd: null,
      status: 'ok',
    }, { onCost: spy as InvocationCostHook });

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT call onCost when no hook is passed', async () => {
    const org = await seedOrg();
    await expect(recordModelInvocation(t.db, {
      orgId: org.id,
      source: 'conversation',
      model: 'gemini-2.5-flash',
      conversationId: `c-${randomUUID()}`,
      costUsd: '0.03',
      status: 'ok',
    })).resolves.toBeUndefined();
  });
});
