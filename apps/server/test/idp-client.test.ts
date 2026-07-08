import { describe, expect, it } from 'vitest';
import { firebaseIdpAuth } from '../src/integrations/idp/client.js';

describe('firebaseIdpAuth', () => {
  it('returns a singleton Auth bound to the project (no duplicate app init)', () => {
    const a = firebaseIdpAuth('proj-1');
    const b = firebaseIdpAuth('proj-1');
    expect(a).toBe(b); // same instance — initializeApp is not called twice
  });
});
