/**
 * Port: billing side-effect hook injected by the SaaS composition.
 * Core never imports billing/credits/fx — callers wire this if they want
 * metering/credit-debit behaviour.
 */
export type InvocationCostHook = (args: {
  orgId: string;
  costUsd: number;
  conversationId: string;
  modelInvocationId: string;
}) => Promise<void>;
