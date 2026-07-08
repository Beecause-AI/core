import { describe, it, expect } from 'vitest';
import {
  dynatraceScopeKey, validateDynatraceScope, dynatraceEntitySelector,
  dynatraceLogErrorQuery, dynatraceMetricSelector, SERVICE_ERROR_RATE_METRIC,
} from '../src/index.js';

describe('dynatrace recipes', () => {
  it('keys a scope pair stably with wildcards for nulls', () => {
    expect(dynatraceScopeKey('prod', 'checkout')).toBe('prod::checkout');
    expect(dynatraceScopeKey('prod', null)).toBe('prod::*');
    expect(dynatraceScopeKey(null, 'checkout')).toBe('*::checkout');
  });
  it('validates a pair against the allowed set', () => {
    const allowed = { pairs: new Set(['prod::checkout']) };
    expect(validateDynatraceScope('prod', 'checkout', allowed).ok).toBe(true);
    expect(validateDynatraceScope('prod', 'cart', allowed).ok).toBe(false);
  });
  it('builds a service entitySelector from scope', () => {
    expect(dynatraceEntitySelector('prod', 'checkout')).toBe('type(SERVICE),mzName("prod"),entityName("checkout")');
    expect(dynatraceEntitySelector('prod', null)).toBe('type(SERVICE),mzName("prod")');
    expect(dynatraceEntitySelector(null, 'checkout')).toBe('type(SERVICE),entityName("checkout")');
  });
  it('builds an error-log query and a metric selector', () => {
    expect(dynatraceLogErrorQuery('prod', 'checkout')).toContain('status');
    expect(dynatraceMetricSelector(SERVICE_ERROR_RATE_METRIC)).toBe('builtin:service.errors.total.rate:avg');
  });
});
