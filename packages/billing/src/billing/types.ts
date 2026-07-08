export type BillingBandId = 'indie' | 'startup' | 'scaleup' | 'enterprise';
export type Entitlement = 'sso' | 'audit_log' | 'byok_premium' | 'priority_support' | 'extended_retention';
export interface Band {
  id: BillingBandId; label: string;
  minEng: number; maxEng: number | null;
  priceCents: number | null;        // null = custom (enterprise)
  priceConfigKey: string | null;    // env key holding the Stripe price id, null for free/custom
  entitlements: Entitlement[];
  selfServe: boolean;
}
