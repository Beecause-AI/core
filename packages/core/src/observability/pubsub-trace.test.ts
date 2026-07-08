import { describe, it, expect, beforeAll } from 'vitest';
import { context, trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { startTracing } from './tracing.js';
import { injectTraceContext, extractTraceContext } from './pubsub-trace.js';

describe('pubsub-trace', () => {
  beforeAll(() => startTracing('test'));

  it('round-trips the trace id through message attributes', () => {
    const sc = { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: '00f067aa0ba902b7', traceFlags: 0 };
    const ctx = trace.setSpanContext(ROOT_CONTEXT, sc);
    const attrs = context.with(ctx, () => injectTraceContext());
    expect(attrs['x-trace-id']).toBe(sc.traceId);
    const extracted = extractTraceContext(attrs);
    expect(trace.getSpanContext(extracted)?.traceId).toBe(sc.traceId);
  });

  it('merges into an existing attributes object', () => {
    const attrs = injectTraceContext({ existing: 'keep' });
    expect(attrs.existing).toBe('keep');
  });
});
