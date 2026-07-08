import { describe, it, expect, vi } from 'vitest';

const { getProjectConnection } = vi.hoisted(() => ({ getProjectConnection: vi.fn() }));

vi.mock('@intellilabs/core', () => ({ getProjectConnection }));

import { projectHasCloudflare } from './signals.js';

describe('projectHasCloudflare', () => {
  it('true when the project has a connection binding', async () => {
    getProjectConnection.mockResolvedValueOnce({ connectionId: 'c1' });
    expect(await projectHasCloudflare({} as any, 'p1')).toBe(true);
  });
  it('false when there is no binding', async () => {
    getProjectConnection.mockResolvedValueOnce(null);
    expect(await projectHasCloudflare({} as any, 'p1')).toBe(false);
  });
});
