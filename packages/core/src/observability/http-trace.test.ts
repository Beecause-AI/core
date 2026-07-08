import { describe, it, expect, beforeAll } from 'vitest';
import { context, trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { startTracing } from './tracing.js';
import { injectTraceHeaders } from './http-trace.js';

describe('injectTraceHeaders', () => {
  beforeAll(() => startTracing('test'));

  it('sets x-trace-id on a plain headers object', () => {
    const sc = { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: '00f067aa0ba902b7', traceFlags: 0 };
    const headers: Record<string, string> = {};
    context.with(trace.setSpanContext(ROOT_CONTEXT, sc), () => injectTraceHeaders(headers));
    expect(headers['x-trace-id']).toBe(sc.traceId);
  });

  it('sets x-trace-id on a Headers instance', () => {
    const sc = { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: '00f067aa0ba902b7', traceFlags: 0 };
    const headers = new Headers();
    context.with(trace.setSpanContext(ROOT_CONTEXT, sc), () => injectTraceHeaders(headers));
    expect(headers.get('x-trace-id')).toBe(sc.traceId);
  });
});
