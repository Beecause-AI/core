import type { FastifyInstance } from 'fastify';
import { getConversation, listConversationSummaries, buildConversationThread } from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireUser, requireProjectMember } from '../auth/guard.js';

export async function conversationRoutes(app: FastifyInstance) {
  const projMember = { preHandler: [resolveOrg, requireUser, requireProjectMember] };

  app.get<{ Params: { slug: string } }>(
    '/api/org/projects/:slug/conversations',
    projMember,
    async (req) => listConversationSummaries(app.db, req.project!.id),
  );

  app.get<{ Params: { slug: string; id: string } }>(
    '/api/org/projects/:slug/conversations/:id',
    projMember,
    async (req, reply) => {
      const convo = await getConversation(app.db, req.params.id);
      // 404 if missing, in another project, or a sub-agent child (only roots are addressable).
      if (!convo || convo.projectId !== req.project!.id || convo.rootConversationId != null) {
        return reply.code(404).send({ error: 'not found' });
      }
      const thread = await buildConversationThread(app.db, req.params.id);
      if (!thread) return reply.code(404).send({ error: 'not found' });
      // Cost is only surfaced when the org has enabled it; tokens are always shown.
      if (!req.org!.showCostUsd) thread.totals.costUsd = null;
      return thread;
    },
  );
}
