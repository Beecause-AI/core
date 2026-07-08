import { describe, it, expect } from 'vitest';
import { ROOT_CONTEXT, trace, defaultTextMapGetter, defaultTextMapSetter } from '@opentelemetry/api';
import { XTraceIdPropagator } from './propagators.js';

const TRACE_ID = '0af7651916cd43dd8448eb211c80319c';

describe('XTraceIdPropagator', () => {
  const p = new XTraceIdPropagator();

  it('injects the active trace id as x-trace-id', () => {
    const ctx = trace.setSpanContext(ROOT_CONTEXT, {
      traceId: TRACE_ID, spanId: '00f067aa0ba902b7', traceFlags: 0,
    });
    const carrier: Record<string, string> = {};
    p.inject(ctx, carrier, defaultTextMapSetter);
    expect(carrier['x-trace-id']).toBe(TRACE_ID);
  });

  it('extracts x-trace-id into a remote span context with the same trace id', () => {
    const carrier = { 'x-trace-id': TRACE_ID };
    const ctx = p.extract(ROOT_CONTEXT, carrier, defaultTextMapGetter);
    const sc = trace.getSpanContext(ctx);
    expect(sc?.traceId).toBe(TRACE_ID);
    expect(sc?.isRemote).toBe(true);
  });

  it('ignores a malformed x-trace-id (returns context unchanged)', () => {
    const ctx = p.extract(ROOT_CONTEXT, { 'x-trace-id': 'nope' }, defaultTextMapGetter);
    expect(trace.getSpanContext(ctx)).toBeUndefined();
  });

  it('exposes the header in fields()', () => {
    expect(p.fields()).toContain('x-trace-id');
  });
});
