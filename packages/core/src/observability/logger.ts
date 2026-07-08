import pino from 'pino';
import { context, trace, TraceFlags } from '@opentelemetry/api';

const SEVERITY: Record<string, string> = {
  trace: 'DEBUG',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARNING',
  error: 'ERROR',
  fatal: 'CRITICAL',
};

const ZERO_TRACE = '0'.repeat(32);

export interface LoggerOptions {
  service: string;
  projectId: string;
  level?: string;
}

/** A pino logger shaped for Cloud Run structured logging: GCP `severity`, `message`
 *  key, ISO `timestamp`, `stack_trace` for Error Reporting, and trace-correlation
 *  fields read from the active OTel span. `destination` is a test seam. */
export function makeLogger(opts: LoggerOptions, destination?: pino.DestinationStream): pino.Logger {
  const { service, projectId } = opts;
  return pino(
    {
      level: opts.level ?? process.env.LOG_LEVEL ?? 'info',
      messageKey: 'message',
      base: { serviceContext: { service } },
      formatters: {
        level: (label) => ({ severity: SEVERITY[label] ?? 'DEFAULT' }),
        // Promote an error's stack to a top-level `stack_trace` field. Cloud Error
        // Reporting auto-detects errors from `stack_trace` (its highest-priority
        // field) but does NOT scan the nested `err.stack_trace`, so without this
        // real unhandled errors are logged yet never grouped. Runs before the
        // `err` serializer, so the value is the raw Error's `.stack`.
        log: (obj) => {
          const err = obj.err as { stack?: string; stack_trace?: string } | undefined;
          const stack = err?.stack ?? err?.stack_trace;
          return stack ? { ...obj, stack_trace: stack } : obj;
        },
      },
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      mixin() {
        const sc = trace.getSpan(context.active())?.spanContext();
        if (!sc || !sc.traceId || sc.traceId === ZERO_TRACE) return {};
        return {
          'logging.googleapis.com/trace': `projects/${projectId}/traces/${sc.traceId}`,
          'logging.googleapis.com/spanId': sc.spanId,
          'logging.googleapis.com/trace_sampled': (sc.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED,
        };
      },
      serializers: {
        err: (err: Error & { code?: unknown }) => ({
          type: err.name,
          message: err.message,
          stack_trace: err.stack,
          code: err.code,
        }),
      },
    },
    destination,
  );
}
