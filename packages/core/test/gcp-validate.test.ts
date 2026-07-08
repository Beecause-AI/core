import { describe, it, expect } from 'vitest';
import { validateGcpScope } from '../src/gcp/validate.js';

describe('validateGcpScope', () => {
  it('allows any project when unrestricted', () => {
    expect(validateGcpScope('anything', { allowed: new Set(), unrestricted: true })).toEqual({ ok: true });
  });
  it('allows a project in the allow-list', () => {
    expect(validateGcpScope('proj-a', { allowed: new Set(['proj-a']), unrestricted: false })).toEqual({ ok: true });
  });
  it('rejects a project not in the allow-list', () => {
    const r = validateGcpScope('proj-x', { allowed: new Set(['proj-a']), unrestricted: false });
    expect(r.ok).toBe(false);
  });
});
