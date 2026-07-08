import type { Dispatcher } from '@intellilabs/engine';
import { injectTraceContext } from '@intellilabs/core';

/** Minimal shape of the @google-cloud/pubsub Topic we use (so we can inject a fake
 *  in tests without importing the SDK). */
export interface OrderedTopic {
  publishMessage(msg: { data: Buffer; orderingKey: string; attributes?: Record<string, string> }): Promise<string>;
}

/** Dispatcher over a Pub/Sub ordered topic: orderingKey = laneId. Trace context is
 *  injected into message attributes so the next turn shares this turn's trace id. */
export function pubsubDispatcher(topic: OrderedTopic): Dispatcher {
  return {
    async publish(laneId, turnId) {
      await topic.publishMessage({
        data: Buffer.from(JSON.stringify({ laneId, turnId })),
        orderingKey: laneId,
        attributes: injectTraceContext(),
      });
    },
  };
}
