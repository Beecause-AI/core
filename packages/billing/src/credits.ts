// OSS no-op stub for credits.
// In the managed SaaS, this manages prepaid AI credit balances in Firestore.
// In the OSS self-hosted build, credits are not enforced.
import type { Db } from '@intellilabs/core';

export type CreditLedgerKind = 'purchase' | 'consumption' | 'grant' | 'refund' | 'adjustment';

export interface CreditLedgerEntry {
  id: string;
  orgId: string;
  kind: CreditLedgerKind;
  amountCents: number;               // signed: + in / - out
  balanceAfterCents: number | null;  // null for best-effort consumption rows (org field is authoritative)
  stripePaymentIntentId?: string | null;
  modelInvocationId?: string | null;
  conversationId?: string | null;
  usdCostCents?: number | null;
  fxRate?: number | null;
  note?: string | null;
  createdAt: Date;
}

/** No-op in OSS build: always returns 0 (unlimited). */
export async function getCreditBalanceCents(_db: Db, _orgId: string): Promise<number> {
  return 0;
}

/** No-op in OSS build: credits are not managed. */
export async function addCredits(
  _db: Db,
  _args: {
    orgId: string; amountCents: number;
    kind: Exclude<CreditLedgerKind, 'consumption'>;
    stripePaymentIntentId?: string; note?: string; ledgerId?: string;
  },
): Promise<{ balanceAfterCents: number; applied: boolean }> {
  return { balanceAfterCents: 0, applied: false };
}

/** No-op in OSS build: credit debits are not enforced. */
export async function debitCreditsForInvocation(
  _db: Db,
  _args: { orgId: string; costUsd: number; fxRate: number; modelInvocationId: string; conversationId: string },
): Promise<void> {
  // no-op
}

/** No-op in OSS build: returns empty ledger. */
export async function listCreditLedger(_db: Db, _orgId: string, _limit = 20): Promise<CreditLedgerEntry[]> {
  return [];
}
