import type { Db } from '../store/firestore.js';
import { col } from '../store/collections.js';
import { FieldValue } from '../store/codec.js';

export type PlanLimits = {
  maxProjects: number | null;
  maxMembersPerOrg: number | null;
  maxAssistantsPerProject: number | null;
  monthlyAiUsageTokens: number | null;
};
/** Keyed by plan name (slug-like, e.g. 'free'); null limit = unlimited. */
export type AllPlanLimits = Record<string, PlanLimits>;

export const PLAN_LIMITS_KEY = 'planLimits';

export async function getGlobalSetting<T>(db: Db, key: string): Promise<T | null> {
  const snap = await col(db, 'global_settings').doc(key).get();
  return snap.exists ? ((snap.data()?.value as T | undefined) ?? null) : null;
}

export async function setGlobalSetting(db: Db, key: string, value: unknown): Promise<void> {
  // doc id == natural key, so upsert is a merge-set (replaces onConflictDoUpdate).
  await col(db, 'global_settings').doc(key).set(
    { key, value, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

export async function getPlanLimits(db: Db): Promise<AllPlanLimits> {
  return (await getGlobalSetting<AllPlanLimits>(db, PLAN_LIMITS_KEY)) ?? {};
}

export async function setPlanLimits(db: Db, limits: AllPlanLimits): Promise<void> {
  await setGlobalSetting(db, PLAN_LIMITS_KEY, limits);
}
