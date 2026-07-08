import { describe, it, expect } from 'vitest';
import { forecastTeamCost } from './forecast.js';

const lead = { model: 'gemini-3.1-pro-preview', isLead: true };
const contact = { model: 'gemini-3-flash-preview', isLead: false };
const spec = { model: 'gemini-3-flash-preview', isLead: false };

describe('forecastTeamCost', () => {
  it('returns three tiers with increasing tokens and cost', () => {
    const f = forecastTeamCost([lead, contact, spec]);
    expect(f.basic.inputTokens).toBeGreaterThan(0);
    expect(f.medium.inputTokens).toBeGreaterThan(f.basic.inputTokens);
    expect(f.large.inputTokens).toBeGreaterThan(f.medium.inputTokens);
    expect(f.basic.costUsd).toBeLessThan(f.large.costUsd);
  });
  it('prices the lead on its own model', () => {
    const cheapTeam = forecastTeamCost([{ ...lead, model: 'gemini-3-flash-preview' }, contact, spec]);
    const proTeam = forecastTeamCost([lead, contact, spec]);
    expect(proTeam.large.costUsd).toBeGreaterThan(cheapTeam.large.costUsd); // pro lead costs more
  });
  it('handles a cheap-only team', () => {
    const f = forecastTeamCost([contact, spec]);
    expect(f.basic.costUsd).toBeGreaterThanOrEqual(0);
  });
});
