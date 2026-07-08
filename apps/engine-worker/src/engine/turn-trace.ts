import type { Db, QueuedTurn } from '@intellilabs/core';
import { createTrace, addTraceStep, startTraceStep, finishTraceStep, finalizeTrace, makeLogger } from '@intellilabs/core';
import { costUsd, type TurnTrace, type SpanStatus, type ToolStepDetail } from '@intellilabs/engine';
import { SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type { FastifyBaseLogger } from 'fastify';

const nowMs = () => Date.now();
const fallbackLog = makeLogger({ service: 'engine-worker', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

/** Build the EngineDeps.trace factory: each turn gets a TurnTrace that emits OTel GenAI
 *  spans AND persists trace_steps + a traces rollup. DB writes are best-effort: telemetry
 *  must never fail a turn, so failures are caught and logged. end() is idempotent. */
export function makeTurnTrace(db: Db, tracer: Tracer, logger: FastifyBaseLogger = fallbackLog) {
  return (turn: QueuedTurn): TurnTrace => {
    const root = tracer.startSpan('invoke_agent', {
      attributes: { 'gen_ai.operation.name': 'invoke_agent' },
    });
    const otelTraceId = root.spanContext().traceId;

    let traceId: string | null = null;
    const ready = createTrace(db, {
      orgId: turn.orgId,
      conversationId: turn.laneId,
      turnId: turn.id,
      source: turn.source,
      otelTraceId,
    })
      .then((t) => {
        traceId = t.id;
      })
      .catch((e) => {
        logger.error({ err: e }, 'trace create failed');
      });

    let totalIn = 0, totalOut = 0, totalCost = 0, modelCalls = 0, toolCalls = 0;
    let ended = false;

    const writeStep = (s: {
      type: 'model_call' | 'tool_call';
      name: string;
      status: 'ok' | 'error';
      startedAt: Date;
      endedAt: Date;
      latencyMs: number;
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      error?: string | null;
      argsPreview?: string | null;
      resultPreview?: string | null;
      args?: string | null;
      result?: string | null;
      childConversationId?: string | null;
    }) =>
      ready
        .then(() => {
          if (traceId) return addTraceStep(db, { ...s, traceId });
        })
        .catch((e) => logger.error({ err: e }, 'trace step failed'));

    return {
      startModelCall(model: string) {
        const span = tracer.startSpan('chat', {
          attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.request.model': model },
        });
        const started = nowMs();
        let inTok = 0, outTok = 0;
        return {
          setUsage(i: number, o: number) {
            inTok = i;
            outTok = o;
            span.setAttribute('gen_ai.usage.input_tokens', i);
            span.setAttribute('gen_ai.usage.output_tokens', o);
          },
          end(status: SpanStatus, error?: string) {
            const ended2 = nowMs();
            const c = costUsd(model, inTok, outTok);
            if (error) span.setStatus({ code: SpanStatusCode.ERROR, message: error });
            span.setAttribute('gen_ai.usage.cost', c);
            span.end();
            modelCalls++;
            totalIn += inTok;
            totalOut += outTok;
            totalCost += c;
            void writeStep({
              type: 'model_call',
              name: model,
              status,
              startedAt: new Date(started),
              endedAt: new Date(ended2),
              latencyMs: ended2 - started,
              inputTokens: inTok,
              outputTokens: outTok,
              costUsd: c,
              error,
            });
          },
        };
      },
      startToolCall(name: string, kind?: string) {
        const span = tracer.startSpan('execute_tool', {
          attributes: {
            'gen_ai.operation.name': 'execute_tool',
            'gen_ai.tool.name': name,
            ...(kind ? { 'gen_ai.tool.type': kind } : {}),
          },
        });
        const started = nowMs();
        // Persist a 'running' tool step BEFORE the tool executes so it shows live; finish updates it.
        const stepIdReady: Promise<string | null> = ready
          .then(() => (traceId ? startTraceStep(db, { traceId, type: 'tool_call', name, startedAt: new Date(started) }) : null))
          .catch((e) => { logger.error({ err: e }, 'trace tool start failed'); return null; });
        return {
          end(status: SpanStatus, detail?: ToolStepDetail) {
            const ended2 = nowMs();
            if (detail?.error) span.setStatus({ code: SpanStatusCode.ERROR, message: detail.error });
            span.end();
            toolCalls++;
            void stepIdReady
              .then(async (id) => {
                const fields = {
                  status,
                  endedAt: new Date(ended2),
                  latencyMs: ended2 - started,
                  error: detail?.error ?? null,
                  argsPreview: detail?.argsPreview ?? null,
                  resultPreview: detail?.resultPreview ?? null,
                  args: detail?.args ?? null,
                  result: detail?.result ?? null,
                  childConversationId: detail?.childConversationId ?? null,
                };
                if (id) { await finishTraceStep(db, id, fields); return; }
                // start insert failed → write the full step now (one-shot fallback)
                if (traceId) await addTraceStep(db, { traceId, type: 'tool_call', name, startedAt: new Date(started), ...fields });
              })
              .catch((e) => logger.error({ err: e }, 'trace tool finish failed'));
          },
        };
      },
      end(status: SpanStatus, finishReason?: string, error?: string) {
        if (ended) return;
        ended = true;
        if (finishReason) root.setAttribute('gen_ai.response.finish_reasons', finishReason);
        if (error) root.setStatus({ code: SpanStatusCode.ERROR, message: error });
        root.end();
        const traceStatus: 'ok' | 'error' | 'cancelled' =
          status === 'error' ? 'error' : finishReason === 'cancelled' ? 'cancelled' : 'ok';
        void ready
          .then(() => {
            if (traceId)
              return finalizeTrace(db, traceId, {
                status: traceStatus,
                endedAt: new Date(),
                totalInputTokens: totalIn,
                totalOutputTokens: totalOut,
                totalCostUsd: totalCost,
                modelCallCount: modelCalls,
                toolCallCount: toolCalls,
                otelTraceId,
              });
          })
          .catch((e) => logger.error({ err: e }, 'trace finalize failed'));
      },
    };
  };
}
