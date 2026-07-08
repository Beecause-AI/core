import fastify, { type FastifyInstance, type FastifyRequest, type FastifyBaseLogger } from 'fastify';
import { z, ZodError } from 'zod';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import { context } from '@opentelemetry/api';
import { extractTraceContext } from '@intellilabs/core';

export const BuildJob = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1).optional(),
  repoFullName: z.string().min(1),
  ref: z.string().optional(),
  mode: z.enum(['initial', 'manual', 'incremental']),
  buildId: z.string().min(1).optional(),
  operationId: z.string().min(1).optional(),
  phase: z.enum(['structure', 'architecture', 'flows', 'dependencies', 'finalize']).optional(),
});
export type BuildJob = z.infer<typeof BuildJob>;

export const TeamAutogenJobSchema = z.object({
  orgId: z.string().min(1),
  projectId: z.string().min(1),
  proposalId: z.string().min(1),
});

// Pub/Sub push wraps the published payload: { message: { data: base64(json) }, subscription }.
// The job is base64-encoded inside message.data — it is NOT the request body directly.
const PushEnvelope = z.object({ message: z.object({ data: z.string(), attributes: z.record(z.string(), z.string()).optional() }) });

export type GraphBuilderDeps = {
  /** Called for every POST /api/internal/build request.
   *  Returns true to allow, false to reject with 401.
   *  Defaults to deny-all when unset (SERVICE_AUDIENCE unset = bypass only via explicit true). */
  verifyServiceAuth?: (req: FastifyRequest) => Promise<boolean>;
  /** Called with the parsed BuildJob after auth passes.
   *  Defaults to a no-op stub (replaced in Task 6). */
  onBuild?: (job: BuildJob) => Promise<void>;
  /** Called with the parsed TeamAutogenJob after auth passes. */
  onTeamAutogen?: (job: z.infer<typeof TeamAutogenJobSchema>) => Promise<void>;
  /** Structured logger; omitted in tests (silent). */
  logger?: FastifyBaseLogger;
};

export async function buildApp(opts: GraphBuilderDeps): Promise<FastifyInstance> {
  const app = fastify({
    loggerInstance: opts.logger,
    disableRequestLogging: !opts.logger,
    trustProxy: 1,
  });
  await app.register(new FastifyOtelInstrumentation().plugin());
  const verifyServiceAuth = opts.verifyServiceAuth ?? (async () => false);
  const onBuild = opts.onBuild ?? (async () => {});
  const onTeamAutogen = opts.onTeamAutogen ?? (async () => {});

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError)
      return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  app.get('/api/healthz', async () => ({ ok: true }));

  app.post(
    '/api/internal/build',
    {
      preHandler: async (req, reply) => {
        if (!(await verifyServiceAuth(req))) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
      },
    },
    async (req, reply) => {
      // Decode the Pub/Sub push envelope → BuildJob. A malformed envelope/payload is a
      // poison message: ack-drop it (200) so Pub/Sub stops redelivering it forever (this
      // subscription has no dead-letter policy). Only genuine processing errors should nack.
      const env = PushEnvelope.safeParse(req.body);
      if (!env.success) return reply.code(200).send({ dropped: 'envelope' });
      let decoded: unknown;
      try { decoded = JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')); }
      catch { return reply.code(200).send({ dropped: 'json' }); }
      const parsed = BuildJob.safeParse(decoded);
      if (!parsed.success) return reply.code(200).send({ dropped: 'schema' });
      await context.with(extractTraceContext(env.data.message.attributes ?? {}), () => onBuild(parsed.data));
      return reply.code(202).send({ accepted: true });
    },
  );

  app.post(
    '/api/internal/team-autogen',
    {
      preHandler: async (req, reply) => {
        if (!(await verifyServiceAuth(req))) {
          return reply.code(401).send({ error: 'unauthorized' });
        }
      },
    },
    async (req, reply) => {
      const env = PushEnvelope.safeParse(req.body);
      if (!env.success) return reply.code(200).send({ dropped: 'envelope' });
      let decoded: unknown;
      try { decoded = JSON.parse(Buffer.from(env.data.message.data, 'base64').toString('utf8')); }
      catch { return reply.code(200).send({ dropped: 'json' }); }
      const parsed = TeamAutogenJobSchema.safeParse(decoded);
      if (!parsed.success) return reply.code(200).send({ dropped: 'schema' });
      try {
        await context.with(extractTraceContext(env.data.message.attributes ?? {}), () => onTeamAutogen(parsed.data));
      } catch (err) {
        // The failure is already persisted to the proposal (status 'failed') by the worker. Ack
        // (200) instead of nacking: a redelivery would re-run the whole design from scratch —
        // wiping the in-progress fleet conversation/history — which is worse than a clean failure
        // the user can retry on demand.
        app.log.error({ err }, '[team-autogen] job failed; ack-dropping to avoid a destructive restart');
        return reply.code(200).send({ failed: true });
      }
      return reply.code(202).send({ accepted: true });
    },
  );

  return app;
}
