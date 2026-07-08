import { MODEL_PRICES } from '../models/pricing.js';

export interface AgentForecastInput {
  model: string;
  isLead?: boolean;
}
export interface TierForecast { inputTokens: number; outputTokens: number; costUsd: number }
export interface TeamForecast { basic: TierForecast; medium: TierForecast; large: TierForecast }

// Work profile per tier, anchored to the common RCA scenarios (see the spec):
// model-call counts per ROLE + per-call token estimates. input grows with investigation depth.
// NOTE: Phase 7 reworks the forecast model. Each agent now has a single model (no tier/
// escalation); the orchestrator (isLead) drives the loop, everyone else is a specialist.
interface Profile { leadCalls: number; specialistCalls: number; inputPerCall: number; outputPerCall: number }
const PROFILES: Record<keyof TeamForecast, Profile> = {
  basic:  { leadCalls: 3,  specialistCalls: 2, inputPerCall: 3_500,  outputPerCall: 500 }, // memory-assisted: one specialist, few loops
  medium: { leadCalls: 6,  specialistCalls: 4, inputPerCall: 8_000,  outputPerCall: 700 },
  large:  { leadCalls: 12, specialistCalls: 6, inputPerCall: 15_000, outputPerCall: 900 },
};

const CHEAP_FALLBACK = 'gemini-3-flash-preview';
function priceFor(model: string) { return MODEL_PRICES[model] ?? MODEL_PRICES[CHEAP_FALLBACK]!; }
function resolveModel(a: AgentForecastInput): string { return a.model || CHEAP_FALLBACK; }

function tierForecast(agents: AgentForecastInput[], p: Profile): TierForecast {
  let inTok = 0, outTok = 0, cost = 0;
  for (const a of agents) {
    const calls = a.isLead ? p.leadCalls : p.specialistCalls;
    const price = priceFor(resolveModel(a));
    const ai = calls * p.inputPerCall, ao = calls * p.outputPerCall;
    inTok += ai; outTok += ao;
    cost += (ai / 1_000_000) * price.inputPer1M + (ao / 1_000_000) * price.outputPer1M;
  }
  return { inputTokens: inTok, outputTokens: outTok, costUsd: Number(cost.toFixed(4)) };
}

export function forecastTeamCost(agents: AgentForecastInput[]): TeamForecast {
  return { basic: tierForecast(agents, PROFILES.basic), medium: tierForecast(agents, PROFILES.medium), large: tierForecast(agents, PROFILES.large) };
}
