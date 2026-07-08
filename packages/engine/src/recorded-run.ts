import { ProviderError, type ModelEvent, type ModelProvider, type ModelRequest, type ProviderContext } from './provider.js';

/** True when a stream error is a provider rate-limit (429) — drives the `rateLimited` telemetry
 *  flag so every throttled attempt is visible, not just the final give-up. */
export function isRateLimitError(err: unknown): boolean {
  if (err instanceof ProviderError) return err.kind === 'rate_limited' || err.status === 429;
  return typeof (err as { status?: number })?.status === 'number' && (err as { status?: number }).status === 429;
}

export interface InvocationRecord {
  source: string;
  orgId?: string | null;
  provider?: string | null;
  conversationId?: string | null;
  buildId?: string | null;
  phase?: string | null;
  model: string;
  messages: unknown;
  output: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  /** 'deferred' marks a model call the engine SKIPPED because the breaker was open — recorded so
   *  the back-off shows on the run timeline, not just the attempts that actually hit the provider. */
  status: 'ok' | 'error' | 'deferred';
  error?: string | null;
  rateLimited?: boolean;
}

/** What's known BEFORE a model call runs — enough to persist an in-flight (`running`) row. */
export interface InvocationStart {
  source: string;
  orgId?: string | null;
  provider?: string | null;
  conversationId?: string | null;
  buildId?: string | null;
  phase?: string | null;
  model: string;
  messages: unknown;
}

/**
 * Two-phase recorder. `start` (optional) persists an in-flight row BEFORE the call and returns
 * its id; `finish` completes it (passed the id from start, or null if start was absent/failed —
 * in which case finish should insert the whole record). Both are best-effort.
 */
export interface InvocationRecorder {
  start?(rec: InvocationStart): Promise<string | null> | string | null;
  finish(rec: InvocationRecord, id: string | null): void | Promise<void>;
}

export interface RecordMeta {
  source: string;
  orgId?: string | null;
  provider?: string | null;
  conversationId?: string | null;
  buildId?: string | null;
  phase?: string | null;
}

/** Drives provider.run to completion (non-streaming), records the full call,
 *  and returns text + usage (like runToText). Recorder failures are swallowed
 *  so they never affect the caller. */
export async function recordedText(
  provider: ModelProvider,
  req: ModelRequest,
  ctx: ProviderContext,
  meta: RecordMeta,
  recorder: InvocationRecorder,
  signal: AbortSignal = new AbortController().signal,
): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  const start = Date.now();
  let text = '';
  let inputTokens = 0;
  let outputTokens = 0;
  let streamError: unknown = undefined;

  // Persist an in-flight row before the call (best-effort) so it shows live; finish updates it.
  let inflightId: string | null = null;
  if (recorder.start) {
    try { inflightId = await recorder.start({ ...meta, model: req.model, messages: req.messages }); }
    catch { inflightId = null; }
  }

  try {
    for await (const ev of provider.run(req, ctx, signal)) {
      if (ev.type === 'text') {
        text += ev.delta;
      } else if (ev.type === 'usage') {
        inputTokens += ev.inputTokens;
        outputTokens += ev.outputTokens;
      }
    }
  } catch (err) {
    streamError = err;
  }

  const latencyMs = Date.now() - start;

  const record: InvocationRecord = streamError == null
    ? {
        ...meta,
        model: req.model,
        messages: req.messages,
        output: text,
        inputTokens,
        outputTokens,
        latencyMs,
        status: 'ok',
      }
    : {
        ...meta,
        model: req.model,
        messages: req.messages,
        output: text,
        inputTokens,
        outputTokens,
        latencyMs,
        status: 'error',
        error: streamError instanceof Error ? streamError.message : String(streamError),
        rateLimited: isRateLimitError(streamError),
      };

  try {
    await recorder.finish(record, inflightId);
  } catch {
    // Best-effort: recorder failures never affect the caller.
  }

  if (streamError != null) {
    throw streamError;
  }

  return { text, inputTokens, outputTokens };
}

/**
 * Streaming recording decorator. Wraps a provider so that EVERY `run` call is
 * recorded (full request messages + full output text + usage) without altering
 * the event stream. Each provider.run yields its events unchanged; on completion
 * (or error) one InvocationRecord is handed to the recorder.
 *
 * Best-effort: recorder failures are swallowed and never affect the stream. A
 * provider error is recorded with status:'error' and then rethrown.
 */
export function recordingProvider(
  base: ModelProvider,
  meta: RecordMeta,
  recorder: InvocationRecorder,
): ModelProvider {
  return {
    id: base.id,
    async *run(req: ModelRequest, ctx: ProviderContext, signal: AbortSignal): AsyncGenerator<ModelEvent> {
      const start = Date.now();
      let output = '';
      let inputTokens = 0;
      let outputTokens = 0;
      let streamError: unknown = undefined;

      // Persist an in-flight ('running') row BEFORE the call so it appears live; finish updates it.
      let inflightId: string | null = null;
      if (recorder.start) {
        try { inflightId = await recorder.start({ ...meta, provider: meta.provider ?? base.id, model: req.model, messages: req.messages }); }
        catch { inflightId = null; }
      }

      try {
        for await (const ev of base.run(req, ctx, signal)) {
          if (ev.type === 'text') {
            output += ev.delta;
          } else if (ev.type === 'usage') {
            inputTokens += ev.inputTokens;
            outputTokens += ev.outputTokens;
          }
          yield ev;
        }
      } catch (err) {
        streamError = err;
      }

      const latencyMs = Date.now() - start;
      const record: InvocationRecord = {
        ...meta,
        provider: meta.provider ?? base.id,
        model: req.model,
        messages: req.messages,
        output,
        inputTokens,
        outputTokens,
        latencyMs,
        status: streamError == null ? 'ok' : 'error',
        error: streamError == null
          ? null
          : streamError instanceof Error ? streamError.message : String(streamError),
        rateLimited: streamError != null && isRateLimitError(streamError),
      };

      try {
        await recorder.finish(record, inflightId);
      } catch {
        // Best-effort: recorder failures never affect the stream.
      }

      if (streamError != null) {
        throw streamError;
      }
    },
  };
}
