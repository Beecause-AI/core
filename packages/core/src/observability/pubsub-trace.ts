import { context, propagation, type Context } from '@opentelemetry/api';

/** Inject the active trace context into Pub/Sub message attributes (string→string).
 *  Pub/Sub attributes never traverse the GFE, so traceparent + x-trace-id ride safely. */
export function injectTraceContext(attrs: Record<string, string> = {}): Record<string, string> {
  propagation.inject(context.active(), attrs);
  return attrs;
}

/** Build a context whose parent is the remote span carried in message attributes. */
export function extractTraceContext(attrs: Record<string, string>): Context {
  return propagation.extract(context.active(), attrs);
}
