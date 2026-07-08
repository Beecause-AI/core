import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { context, trace, ROOT_CONTEXT } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { makeLogger } from './logger.js';

// Initialize context manager for async context propagation in tests
beforeAll(() => {
  const manager = new AsyncLocalStorageContextManager();
  manager.enable();
  context.setGlobalContextManager(manager);
});

afterAll(() => {
  context.disable(); // reset to the default NoopContextManager
});

/** Capture pino output line-by-line as parsed JSON. */
function capture() {
  const lines: any[] = [];
  const stream = { write: (s: string) => { lines.push(JSON.parse(s)); return true; } };
  return { lines, stream: stream as any };
}

describe('makeLogger', () => {
  it('emits severity, message key, timestamp, and serviceContext', () => {
    const { lines, stream } = capture();
    const log = makeLogger({ service: 'svc', projectId: 'proj', level: 'info' }, stream);
    log.warn('hello');
    expect(lines[0].severity).toBe('WARNING');
    expect(lines[0].message).toBe('hello');
    expect(typeof lines[0].timestamp).toBe('string');
    expect(lines[0].serviceContext.service).toBe('svc');
  });

  it('puts an Error stack on stack_trace', () => {
    const { lines, stream } = capture();
    const log = makeLogger({ service: 'svc', projectId: 'proj' }, stream);
    log.error({ err: new Error('boom') }, 'failed');
    expect(lines[0].err.stack_trace).toContain('boom');
    expect(lines[0].severity).toBe('ERROR');
  });

  it('promotes the error stack to a top-level stack_trace for Error Reporting', () => {
    const { lines, stream } = capture();
    const log = makeLogger({ service: 'svc', projectId: 'proj' }, stream);
    log.error({ err: new Error('kaboom') }, 'failed');
    // Top-level stack_trace is what Cloud Error Reporting auto-detects...
    expect(lines[0].stack_trace).toContain('Error: kaboom');
    expect(lines[0].stack_trace).toContain('at ');
    // ...while the human-readable message and serviceContext are preserved.
    expect(lines[0].message).toBe('failed');
    expect(lines[0].serviceContext.service).toBe('svc');
  });

  it('stamps the active trace id as logging.googleapis.com fields', () => {
    const { lines, stream } = capture();
    const log = makeLogger({ service: 'svc', projectId: 'proj' }, stream);
    const sc = { traceId: '0af7651916cd43dd8448eb211c80319c', spanId: '00f067aa0ba902b7', traceFlags: 1 };
    const ctx = trace.setSpanContext(ROOT_CONTEXT, sc);
    context.with(ctx, () => log.info('traced'));
    expect(lines[0]['logging.googleapis.com/trace']).toBe('projects/proj/traces/0af7651916cd43dd8448eb211c80319c');
    expect(lines[0]['logging.googleapis.com/spanId']).toBe('00f067aa0ba902b7');
    expect(lines[0]['logging.googleapis.com/trace_sampled']).toBe(true);
  });

  it('omits trace fields when no span is active', () => {
    const { lines, stream } = capture();
    const log = makeLogger({ service: 'svc', projectId: 'proj' }, stream);
    log.info('untraced');
    expect(lines[0]['logging.googleapis.com/trace']).toBeUndefined();
  });
});
