import fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import { ZodError } from 'zod';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import type { EngineRuntime } from './engine/bootstrap.js';

export type WorkerDeps = {
  engine: EngineRuntime | null;
  /** Verifies the Pub/Sub OIDC push token (real verifier in prod, fake in tests). */
  verify: (token: string) => Promise<boolean>;
  /** Structured logger; omitted in tests (silent). */
  logger?: FastifyBaseLogger;
};

export async function buildWorkerApp(deps: WorkerDeps): Promise<FastifyInstance> {
  const app = fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: !deps.logger,
    trustProxy: 1,
  });
  await app.register(new FastifyOtelInstrumentation().plugin());
  app.decorate('engine', deps.engine);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  app.get('/api/healthz', async () => ({ ok: true }));

  if (deps.engine) {
    const { runTurnRoutes } = await import('./routes/run-turn.js');
    await app.register(runTurnRoutes, { verify: deps.verify });
    const { deadLetterRoutes } = await import('./routes/dead-letter.js');
    await app.register(deadLetterRoutes, { verify: deps.verify });
    // Report-gen consumer is only wired when Vertex is configured (engine.reportConsumer present).
    if (deps.engine.reportConsumer) {
      const { runReportRoutes } = await import('./routes/run-report.js');
      await app.register(runReportRoutes, { verify: deps.verify, deps: deps.engine.reportConsumer });
    }
  }
  return app;
}
