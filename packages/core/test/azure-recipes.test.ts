import { describe, expect, it } from 'vitest';
import { azureScopeKey, validateAzureScope, latencyKql, logErrorKql, listTracesKql, getTraceKql } from '../src/azure/recipes.js';

describe('validateAzureScope', () => {
  const allowed = { pairs: new Set([azureScopeKey('sub-1', 'ws-1'), azureScopeKey('sub-1', null)]) };
  it('accepts an in-scope (subscription, workspace) pair', () => {
    expect(validateAzureScope('sub-1', 'ws-1', allowed)).toEqual({ ok: true });
    expect(validateAzureScope('sub-1', null, allowed)).toEqual({ ok: true });
  });
  it('rejects an out-of-scope pair', () => {
    expect(validateAzureScope('sub-2', 'ws-1', allowed).ok).toBe(false);
  });
});

describe('KQL recipe builders', () => {
  it('latencyKql computes request duration percentiles', () => {
    expect(latencyKql()).toMatch(/percentiles\(DurationMs/);
  });
  it('logErrorKql limits and filters error-like entries', () => {
    expect(logErrorKql(25)).toMatch(/take 25/);
  });
  it('listTracesKql filters failed requests', () => {
    expect(listTracesKql(undefined, 50)).toMatch(/AppRequests/);
    expect(listTracesKql('ResultCode == "500"', 50)).toContain('ResultCode == "500"');
  });
  it('getTraceKql correlates by OperationId', () => {
    expect(getTraceKql('abc')).toContain('OperationId == "abc"');
  });
  it('getTraceKql sanitizes operationId to prevent KQL injection', () => {
    expect(getTraceKql('abc" | union secrets //')).toContain('OperationId == "abcunionsecrets"');
  });
});
