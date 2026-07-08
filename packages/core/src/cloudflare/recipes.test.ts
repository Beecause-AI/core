import { describe, it, expect } from 'vitest';
import { httpErrorSummary, latencySummary, firewallEvents, workerErrors } from './recipes.js';
import { validateGraphqlScope } from './validate.js';

const ZONE = { kind: 'zone' as const, zoneTag: 'z1' };
const ACCT = { kind: 'account' as const, accountTag: 'a1' };

describe('recipe builders produce in-scope GraphQL', () => {
  it('httpErrorSummary (zone) scopes to the bound zone and passes validation', () => {
    const q = httpErrorSummary(ZONE, { window: '1h' });
    expect(q).toContain('httpRequestsAdaptiveGroups');
    expect(validateGraphqlScope(q, ZONE)).toEqual({ ok: true });
  });
  it('latencySummary (zone) validates', () => {
    expect(validateGraphqlScope(latencySummary(ZONE, { window: '1h' }), ZONE).ok).toBe(true);
  });
  it('firewallEvents (zone) validates and queries firewallEventsAdaptiveGroups', () => {
    const q = firewallEvents(ZONE, { window: '1h' });
    expect(q).toContain('firewallEventsAdaptiveGroups');
    expect(validateGraphqlScope(q, ZONE).ok).toBe(true);
  });
  it('workerErrors (account) validates, optional script filter embeds', () => {
    const q = workerErrors(ACCT, { window: '1h', scripts: ['pay-worker'] });
    expect(q).toContain('workersInvocationsAdaptiveGroups');
    expect(q).toContain('pay-worker');
    expect(validateGraphqlScope(q, ACCT).ok).toBe(true);
  });
  it('workerErrors (account) without scripts omits the script filter', () => {
    const q = workerErrors(ACCT, { window: '1h' });
    expect(q).not.toContain('scriptName_in');
    expect(validateGraphqlScope(q, ACCT).ok).toBe(true);
  });
});
