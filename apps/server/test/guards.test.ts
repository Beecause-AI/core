import { describe, expect, it } from 'vitest';
import { isOrgAdminRole } from '../src/auth/guard.js';

describe('isOrgAdminRole', () => {
  it('treats owner and admin as org admin', () => {
    expect(isOrgAdminRole('owner')).toBe(true);
    expect(isOrgAdminRole('manager')).toBe(true);
    expect(isOrgAdminRole('user')).toBe(false);
    expect(isOrgAdminRole(undefined)).toBe(false);
  });
});
