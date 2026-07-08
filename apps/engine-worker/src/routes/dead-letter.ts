import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { z } from 'zod';
import { listActiveTurns, markTurnFailed, getTurn } from '@intellilabs/core';
import type { EngineRuntime } from '../engine/bootstrap.js';
import { resumeParentForChild } from '../engine/subagent.js';

const Envelope = z.object({ message: z.object({ data: z.string() }) });
const Payload = z.object({ laneId: z.string().min(1) });

export interface DeadLetterOpts extends FastifyPluginOptions {
  /** Same Pub/Sub OIDC verifier as run-turn (the DLQ push reuses the push audience). */
  verify: (token: string) => Promise<boolean>;
}

/** Terminal handler for turns that exhausted Pub/Sub redelivery and landed on the dead-letter
 *  topic. With the bounded-deferral cap this should be rare, but it's the safety net: rather than
 *  leaving the poison turn 'queued' forever (orphaning its parent orchestrator + Slack thread),
 *  mark it failed and resume the parent — the same graceful path a normal failure takes.
 *  ALWAYS acks (200): a dead-letter has no further redelivery budget to nack against. */
export async function deadLetterRoutes(app: FastifyInstance, opts: DeadLetterOpts) {
  app.post('/api/internal/dead-letter', async (req, reply) => {
    const auth = req.headers.authorization;
    const token = auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : '';
    if (!token || !(await opts.verify(token))) return reply.code(401).send({ error: 'unauthenticated' });

    const env = Envelope.safeParse(req.body);
    if (!env.success) return reply.code(200).send({ dropped: true });
    let decoded: unknown;
    try { decoded = JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')); }
    catch { return reply.code(200).send({ dropped: true }); }
    const parsed = Payload.safeParse(decoded);
    if (!parsed.success) return reply.code(200).send({ dropped: true });
    const { laneId } = parsed.data;

    const engine = app.engine as EngineRuntime;
    // The poison turn is the oldest still-in-flight (queued/running) turn on the lane.
    const active = await listActiveTurns(engine.db, [laneId]);
    const poison = active[0];
    if (!poison) return reply.code(200).send({ resolved: 'already-terminal' });

    await markTurnFailed(engine.db, poison.id, { reason: 'dead_lettered' });
    const failed = await getTurn(engine.db, poison.id);
    // Resume the parent (with a failure note) if this was a sub-agent; otherwise report to Slack.
    const handledChild = failed
      ? await resumeParentForChild(engine.db, engine.dispatcher.publish.bind(engine.dispatcher), failed)
      : false;
    if (!handledChild && engine.slackErrorSink && failed) {
      await engine.slackErrorSink(failed).catch(() => { /* best-effort */ });
    }
    if (!handledChild && engine.teamsErrorSink && failed) {
      await engine.teamsErrorSink(failed).catch(() => { /* best-effort */ });
    }
    return reply.code(200).send({ deadLettered: poison.id });
  });
}
