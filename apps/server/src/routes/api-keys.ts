import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createApiKey, listApiKeys, revokeApiKey } from '@intellilabs/core';
import { requireUser, requireOrgMember } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';

const CreateSchema = z.object({
  name: z.string().trim().min(1).max(100),
  // ISO date string; must be in the future when present.
  expiresAt: z.string().datetime().optional(),
});

export async function apiKeyRoutes(app: FastifyInstance) {
  const guard = { preHandler: [resolveOrg, requireUser, requireOrgMember] };

  app.get('/keys', guard, async (req) =>
    listApiKeys(app.db, req.org!.id, req.user!.sub),
  );

  app.post('/keys', guard, async (req, reply) => {
    const parsed = CreateSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) return reply.code(400).send({ error: 'expiry must be in the future' });

    const { plaintext, row } = await createApiKey(app.db, {
      userId: req.user!.sub, orgId: req.org!.id, name: parsed.data.name, expiresAt,
    });
    // plaintext is returned exactly once — the client shows a copy-once banner.
    return reply.code(201).send({ key: plaintext, row });
  });

  app.delete<{ Params: { id: string } }>('/keys/:id', guard, async (req, reply) => {
    const { id } = req.params;
    if (!z.string().min(1).safeParse(id).success) return reply.code(404).send({ error: 'not found' });
    const ok = await revokeApiKey(app.db, { id, orgId: req.org!.id, userId: req.user!.sub });
    if (!ok) return reply.code(404).send({ error: 'not found' });
    return reply.code(204).send();
  });
}
