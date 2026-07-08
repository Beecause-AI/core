import { describe, expect, it } from 'vitest';
import { inMemoryDispatcher } from '../src/dispatcher.js';

describe('inMemoryDispatcher', () => {
  it('records published (laneId, turnId) messages in order', async () => {
    const d = inMemoryDispatcher();
    await d.publish('lane-1', 'turn-a');
    await d.publish('lane-1', 'turn-b');
    expect(d.published).toEqual([
      { laneId: 'lane-1', turnId: 'turn-a' },
      { laneId: 'lane-1', turnId: 'turn-b' },
    ]);
  });

  it('starts with an empty published array', () => {
    const d = inMemoryDispatcher();
    expect(d.published).toEqual([]);
  });

  it('does not share state between independent instances', async () => {
    const a = inMemoryDispatcher();
    const b = inMemoryDispatcher();
    await a.publish('lane-1', 'turn-a');
    expect(a.published).toEqual([{ laneId: 'lane-1', turnId: 'turn-a' }]);
    expect(b.published).toEqual([]);
  });
});
