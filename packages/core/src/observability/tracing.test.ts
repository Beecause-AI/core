import { describe, it, expect, beforeAll } from 'vitest';
import { context, propagation, trace, TraceFlags, defaultTextMapGetter } from '@opentelemetry/api';
import { startTracing, getTracer } from './tracing.js';

describe('startTracing', () => {
  beforeAll(() => startTracing('test-service'));

  it('produces spans with real, non-zero ids and trace_sampled false', () => {
    const span = getTracer().startSpan('unit');
    const sc = span.spanContext();
    expect(sc.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(sc.traceId).not.toBe('0'.repeat(32));
    expect((sc.traceFlags & TraceFlags.SAMPLED)).toBe(0); // AlwaysOff
    span.end();
  });

  it('registers a composite propagator where x-trace-id wins over traceparent', () => {
    const carrier = {
      traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      'x-trace-id': '0af7651916cd43dd8448eb211c80319c',
    };
    const ctx = propagation.extract(context.active(), carrier, defaultTextMapGetter);
    expect(trace.getSpanContext(ctx)?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
  });

  it('is idempotent', () => {
    expect(() => startTracing('test-service')).not.toThrow();
  });
});
