/** The engine's "doorbell" transport. publish wakes the runtime to process a lane;
 *  laneId is the ordering key so same-lane turns deliver in order. */
export interface Dispatcher {
  publish(laneId: string, turnId: string): Promise<void>;
}

export interface InMemoryDispatcher extends Dispatcher {
  readonly published: Array<{ laneId: string; turnId: string }>;
}

/** Test/dev dispatcher that records published messages instead of sending them. */
export function inMemoryDispatcher(): InMemoryDispatcher {
  const published: Array<{ laneId: string; turnId: string }> = [];
  return {
    published,
    async publish(laneId, turnId) { published.push({ laneId, turnId }); },
  };
}
