import { describe, it, expect } from 'vitest';
import { getSystemAgent } from '../src/system-agents/registry.js';

describe('teams system agent', () => {
  it('is registered with no posting tools', () => {
    const a = getSystemAgent('teams');
    expect(a).not.toBeNull();
    expect(a!.key).toBe('teams');
    expect(a!.tools).toEqual([]);
  });
});
