// OSS no-op stub for billing-usage.
// In the managed SaaS, this writes to Firestore org_billing_usage.
// In the OSS self-hosted build, metering is not enforced.
import type { Db } from '@intellilabs/core';

export interface BillableUsage {
  orgId: string;
  period: string;
  billableCostUsd: number;
  invocationCount: number;
}

/** Calendar month key in UTC, e.g. '2026-06'. */
export function periodKey(d: Date = new Date()): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function usageDocId(orgId: string, period: string): string {
  return `${orgId}_${period}`;
}

/** No-op in OSS build: usage is not metered. */
export async function incrementBillableUsage(
  _db: Db,
  _orgId: string,
  _costUsd: number,
  _when: Date = new Date(),
): Promise<void> {
  // no-op
}

export async function getBillableUsage(
  _db: Db,
  orgId: string,
  period: string = periodKey(),
): Promise<BillableUsage> {
  return { orgId, period, billableCostUsd: 0, invocationCount: 0 };
}

export async function isOverSpendCap(
  _db: Db,
  _org: { id: string; aiSpendCapUsd: number | null },
): Promise<boolean> {
  return false;
}
