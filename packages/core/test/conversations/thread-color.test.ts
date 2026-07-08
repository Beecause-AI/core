import { describe, expect, it } from 'vitest';
import { colorFor, THREAD_PALETTE } from '../../src/conversations/thread.js';

describe('colorFor', () => {
  it('is deterministic for the same key', () => {
    expect(colorFor('abc')).toBe(colorFor('abc'));
  });
  it('returns a value from the palette', () => {
    expect(THREAD_PALETTE).toContain(colorFor('some-conversation-id'));
  });
  it('spreads different keys across the palette (not all identical)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(colorFor));
    expect(colors.size).toBeGreaterThan(1);
  });
});
