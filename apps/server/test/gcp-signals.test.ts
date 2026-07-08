import { describe, it, expect, vi } from 'vitest';

vi.mock('@intellilabs/core', () => ({
  getGcpProjectConnection: vi.fn(),
  getGcpConnection: vi.fn(),
}));
import { getGcpProjectConnection, getGcpConnection } from '@intellilabs/core';
import { projectGcpContext } from '../src/integrations/gcp/signals.js';

const db = {} as never;

describe('projectGcpContext', () => {
  it('reports no connection when unbound', async () => {
    vi.mocked(getGcpProjectConnection).mockResolvedValue(null as never);
    const ctx = await projectGcpContext(db, 'orgX', 'projX');
    expect(ctx.hasConnection).toBe(false);
    expect([...ctx.signals]).toEqual([]);
  });
  it('returns the connection signals when bound', async () => {
    vi.mocked(getGcpProjectConnection).mockResolvedValue({ connectionId: 'c1' } as never);
    vi.mocked(getGcpConnection).mockResolvedValue({ id: 'c1', metadata: { availableSignals: ['monitoring', 'logging'] } } as never);
    const ctx = await projectGcpContext(db, 'orgX', 'projX');
    expect(ctx.hasConnection).toBe(true);
    expect([...ctx.signals].sort()).toEqual(['logging', 'monitoring']);
  });
});
