import {
  type Context,
  type TextMapPropagator,
  type TextMapGetter,
  type TextMapSetter,
  trace,
  isSpanContextValid,
  TraceFlags,
} from '@opentelemetry/api';

const X_TRACE_ID = 'x-trace-id';
const TRACE_ID_RE = /^[0-9a-f]{32}$/i;
// Synthetic, valid (non-zero) parent span id. We never export spans, so the parent
// span id is irrelevant; it only needs to be a valid 16-hex so the SDK treats the
// extracted context as a real parent and propagates the trace id to child spans.
const SYNTHETIC_PARENT_SPAN = 'f'.repeat(16);

/** Propagator for the GFE-immune `x-trace-id` header. Carries only the 32-hex trace
 *  id (GCP's load balancer rewrites `traceparent` but never touches custom headers). */
export class XTraceIdPropagator implements TextMapPropagator {
  inject(context: Context, carrier: unknown, setter: TextMapSetter): void {
    const sc = trace.getSpanContext(context);
    if (sc && isSpanContextValid(sc)) setter.set(carrier, X_TRACE_ID, sc.traceId);
  }

  extract(context: Context, carrier: unknown, getter: TextMapGetter): Context {
    const raw = getter.get(carrier, X_TRACE_ID);
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (!value || !TRACE_ID_RE.test(value)) return context;
    return trace.setSpanContext(context, {
      traceId: value.toLowerCase(),
      spanId: SYNTHETIC_PARENT_SPAN,
      traceFlags: TraceFlags.NONE,
      isRemote: true,
    });
  }

  fields(): string[] {
    return [X_TRACE_ID];
  }
}
