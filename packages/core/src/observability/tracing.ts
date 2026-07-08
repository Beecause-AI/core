import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { ParentBasedSampler, AlwaysOffSampler } from '@opentelemetry/sdk-trace-base';
import { CompositePropagator, W3CTraceContextPropagator } from '@opentelemetry/core';
import { CloudPropagator } from '@google-cloud/opentelemetry-cloud-trace-propagator';
import { trace, type Tracer } from '@opentelemetry/api';
import { XTraceIdPropagator } from './propagators.js';

let started = false;

/** Register a global OTel tracer provider with NO exporter and NO span processor:
 *  spans get real, valid ids (for log correlation) but nothing is ever shipped.
 *  ParentBased(AlwaysOff) keeps trace_sampled honest (=false) and inherits any
 *  incoming trace id. AsyncLocalStorageContextManager is the Node default on
 *  provider.register(). Idempotent — safe to call once per process at startup. */
export function startTracing(_service: string): void {
  if (started) return;
  started = true;
  const provider = new NodeTracerProvider({
    sampler: new ParentBasedSampler({ root: new AlwaysOffSampler() }),
  });
  provider.register({
    // Order matters: CompositePropagator applies propagators in array order on
    // extract, and a later one overrides an earlier one. x-trace-id is LAST so it
    // wins over traceparent (which GFE may rewrite) and X-Cloud-Trace-Context.
    propagator: new CompositePropagator({
      propagators: [
        new CloudPropagator(),
        new W3CTraceContextPropagator(),
        new XTraceIdPropagator(),
      ],
    }),
  });
}

export function getTracer(name = 'intellilabs'): Tracer {
  return trace.getTracer(name);
}
