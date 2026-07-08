import type { Band, BillingBandId, Entitlement } from '../billing/types.js';

export const BANDS: Record<BillingBandId, Band> = {
  indie:      { id: 'indie',      label: 'Indie',      minEng: 0,   maxEng: 9,    priceCents: 0,     priceConfigKey: null,                   entitlements: [],                                                                              selfServe: true  },
  startup:    { id: 'startup',    label: 'Startup',    minEng: 10,  maxEng: 49,   priceCents: 19900, priceConfigKey: 'STRIPE_PRICE_STARTUP', entitlements: ['priority_support'],                                                            selfServe: true  },
  scaleup:    { id: 'scaleup',    label: 'Scaleup',    minEng: 50,  maxEng: 199,  priceCents: 79900, priceConfigKey: 'STRIPE_PRICE_SCALEUP', entitlements: ['priority_support', 'extended_retention'],                                      selfServe: true  },
  enterprise: { id: 'enterprise', label: 'Enterprise', minEng: 200, maxEng: null, priceCents: null,  priceConfigKey: null,                   entitlements: ['sso', 'audit_log', 'byok_premium', 'priority_support', 'extended_retention'], selfServe: false },
};

const ORDER: BillingBandId[] = ['indie', 'startup', 'scaleup', 'enterprise'];

export function bandForEngCount(n: number): BillingBandId {
  for (const id of ORDER) { const b = BANDS[id]; if (n >= b.minEng && (b.maxEng === null || n <= b.maxEng)) return id; }
  return 'enterprise';
}
export function bandHasEntitlement(id: BillingBandId, e: Entitlement): boolean { return BANDS[id].entitlements.includes(e); }
