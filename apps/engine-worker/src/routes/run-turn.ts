import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { context } from '@opentelemetry/api';
import { runConversation } from '@intellilabs/engine';
import { peekNextQueued, getTurn, extractTraceContext } from '@intellilabs/core';
import type { EngineRuntime } from '../engine/bootstrap.js';
import { resumeParentForChild } from '../engine/subagent.js';

// The handler reads the engine off the instance; the decoration is added in Task 8.
declare module 'fastify' {
  interface FastifyInstance { engine: EngineRuntime | null }
}

const Envelope = z.object({ message: z.object({ data: z.string(), attributes: z.record(z.string(), z.string()).optional() }) });
const Payload = z.object({ laneId: z.string().min(1) });

export interface RunTurnOpts extends FastifyPluginOptions {
  /** Verifies the Pub/Sub OIDC bearer token. Injected (real verifier in prod, fake in tests). */
  verify: (token: string) => Promise<boolean>;
}

export async function runTurnRoutes(app: FastifyInstance, opts: RunTurnOpts) {
  app.post('/api/internal/run-turn', async (req, reply) => {
    // 1. Authn: Pub/Sub OIDC token. MUST await the verifier and branch on false.
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || !(await opts.verify(token))) return reply.code(401).send({ error: 'unauthenticated' });

    // 2. Decode the push envelope → payload. Malformed → ack-drop (200).
    const env = Envelope.safeParse(req.body);
    if (!env.success) return reply.code(200).send({ dropped: true });
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')); }
    catch { return reply.code(200).send({ dropped: true }); }
    const parsed = Payload.safeParse(decoded);
    if (!parsed.success) return reply.code(200).send({ dropped: true });
    const { laneId } = parsed.data;

    // 3. Run the lane (single-flight). The route is only registered when engine is set.
    // No try/catch around runConversation is deliberate: a returned outcome is mapped to
    // ack/nack below, but an UNEXPECTED throw (DB/network blip) propagates to Fastify's
    // global 500 handler, which nacks so Pub/Sub redelivers (transient retry); a
    // persistently-poison lane is bounded by maxDeliveryAttempts + the dead-letter topic.
    const engine = app.engine!;
    const traceCtx = extractTraceContext(env.data.message.attributes ?? {});
    const outcome = await context.with(traceCtx, () => runConversation(engine, laneId));

    // 4. Ack semantics.
    if (outcome.kind === 'requeued' || outcome.kind === 'breaker_open') {
      return reply.code(503).send({ retry: outcome.kind });
    }
    if (outcome.kind === 'failed' || outcome.kind === 'cancelled') {
      const turn = await getTurn(engine.db, outcome.turnId);
      // A failed/cancelled CHILD sub-agent must still resume its parent (with a failure note) so the
      // orchestrator carries on instead of hanging forever — the same path a 'done' child takes.
      const handledChild = turn
        ? await resumeParentForChild(engine.db, engine.dispatcher.publish.bind(engine.dispatcher), turn)
        : false;
      // Only surface the failure straight to Slack when it ISN'T a sub-agent whose parent will
      // carry on (a root turn, or an unparented one); otherwise let the orchestrator's reply speak.
      if (!handledChild && engine.slackErrorSink && turn) {
        await engine.slackErrorSink(turn).catch(() => { /* best-effort */ });
      }
      if (!handledChild && engine.teamsErrorSink && turn) {
        await engine.teamsErrorSink(turn).catch(() => { /* best-effort */ });
      }
    }
    if (outcome.kind === 'done') {
      const finishedTurn = await getTurn(engine.db, outcome.turnId);
      // If this was a child sub-agent turn, resume the parent.
      if (finishedTurn) {
        await resumeParentForChild(engine.db, engine.dispatcher.publish.bind(engine.dispatcher), finishedTurn);
      }
      // Rolling conversation summary: best-effort, gated by org flag.
      if (finishedTurn) await engine.maybeSummarize?.(finishedTurn).catch(() => { /* best-effort */ });
    }
    if (outcome.kind === 'done' || outcome.kind === 'failed' || outcome.kind === 'cancelled') {
      const next = await peekNextQueued(engine.db, laneId);
      if (next) await engine.dispatcher.publish(laneId, next.id);
    }
    return reply.code(200).send({ outcome: outcome.kind });
  });
}
