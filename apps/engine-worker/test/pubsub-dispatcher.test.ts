import { describe, expect, it } from 'vitest';
import { pubsubDispatcher } from '../src/engine/pubsub-dispatcher.js';

describe('pubsubDispatcher', () => {
  it('publishes JSON with orderingKey = laneId', async () => {
    const calls: any[] = [];
    const d = pubsubDispatcher({ publishMessage: async (m) => { calls.push(m); return 'id'; } });
    await d.publish('lane-9', 'turn-9');
    expect(calls[0].orderingKey).toBe('lane-9');
    expect(JSON.parse(calls[0].data.toString())).toEqual({ laneId: 'lane-9', turnId: 'turn-9' });
  });
  it('propagates a publishMessage rejection', async () => {
    const d = pubsubDispatcher({ publishMessage: async () => { throw new Error('boom'); } });
    await expect(d.publish('lane-1', 'turn-1')).rejects.toThrow(/boom/);
  });
});
