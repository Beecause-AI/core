// OSS no-op stubs for billing hooks.
// In the managed SaaS, these hooks enforce credit spending and block exhausted orgs.
// In the OSS self-hosted build, no enforcement is applied.
import type { Db, InvocationCostHook, QueuedTurn } from '@intellilabs/core';

/**
 * OSS no-op: returns a cost hook that does nothing.
 * Wire this as the `onCost` argument to `finishModelInvocation` / `recordModelInvocation`.
 */
export function saasInvocationCostHook(
  _db: Db,
  _opts: {
    creditsEnforced: boolean;
    fxRate: () => Promise<number | null>;
  },
): InvocationCostHook {
  return async () => {};
}

/**
 * OSS no-op: always returns false (credits never exhausted).
 * Wire this as the `creditsExhausted` argument to the engine.
 */
export function creditsExhaustedCheck(_db: Db, _opts: { enforced: boolean }): (turn: QueuedTurn) => Promise<boolean> {
  return async (_turn: QueuedTurn): Promise<boolean> => false;
}
