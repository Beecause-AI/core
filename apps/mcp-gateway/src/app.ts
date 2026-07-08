import fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import { z, ZodError } from 'zod';
import { FastifyOtelInstrumentation } from '@fastify/otel';
import type { Db } from '@intellilabs/core';
import type { McpGateway } from './gateway.js';

export type GatewayDeps = {
  db?: Db | null;
  gateway?: McpGateway;
  /** Called with the raw Authorization header value for every /tools/* request.
   *  Returns true to allow, false to reject with 401. Defaults to bypass (always true)
   *  so existing tests and local dev work without config. */
  verifyAuth?: (authHeader: string | undefined) => Promise<boolean>;
  /** Structured logger; omitted in tests (silent). */
  logger?: FastifyBaseLogger;
};

const ListToolsBody = z.object({
  orgId: z.string().min(1),
  serverNames: z.array(z.string()).optional(),
});

const CallToolBody = z.object({
  orgId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown().optional(),
});

export async function buildApp(deps: GatewayDeps): Promise<FastifyInstance> {
  const app = fastify({
    loggerInstance: deps.logger,
    disableRequestLogging: !deps.logger,
    trustProxy: 1,
  });
  await app.register(new FastifyOtelInstrumentation().plugin());
  const verifyAuth = deps.verifyAuth ?? (async () => true);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: 'validation failed', issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal error' });
  });

  app.get('/healthz', async () => ({ ok: true }));

  app.post('/tools/list', async (req, reply) => {
    if (!(await verifyAuth(req.headers.authorization))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!deps.gateway) return reply.send({ tools: [] });
    const body = ListToolsBody.parse(req.body);
    const tools = await deps.gateway.listTools(body.orgId, body.serverNames);
    return reply.send({ tools });
  });

  app.post('/tools/call', async (req, reply) => {
    if (!(await verifyAuth(req.headers.authorization))) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!deps.gateway) return reply.code(404).send({ error: 'no gateway configured' });
    const body = CallToolBody.parse(req.body);
    const result = await deps.gateway.callTool(body.orgId, body.name, body.args ?? {});
    return reply.send(result);
  });

  return app;
}
