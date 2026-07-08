// @intellilabs/billing — OSS no-op stub
// In the open-source build, all billing functions are no-ops.
// The managed SaaS layer replaces this package with real implementations.
// Depends on @intellilabs/core; core MUST NOT depend on this package.

export {
  periodKey, usageDocId, incrementBillableUsage, getBillableUsage, isOverSpendCap,
  type BillableUsage,
} from './billing-usage.js';

export type { BillingBandId, Entitlement, Band } from './billing/types.js';
export { BANDS, bandForEngCount, bandHasEntitlement } from './billing/bands.js';

export {
  getCreditBalanceCents, addCredits, debitCreditsForInvocation, listCreditLedger,
  type CreditLedgerEntry, type CreditLedgerKind,
} from './credits.js';

export { readUsdEurRate, writeUsdEurRate, type UsdEurRate } from './fx.js';

export { saasInvocationCostHook, creditsExhaustedCheck } from './hooks.js';
