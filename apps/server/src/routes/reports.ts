import type { FastifyInstance } from 'fastify';
import { getConversationReport, listReportsForConversation, getLatestReportOfferForConversation, getMembership } from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import { requireUser, requireProjectMember } from '../auth/guard.js';

const CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox";

export async function reportRoutes(app: FastifyInstance) {
  const projMember = { preHandler: [resolveOrg, requireUser, requireProjectMember] };

  // Serve a stored report's HTML via a host-agnostic URL — resolves org/project from
  // the report itself so that a shared flat link (e.g. from a Slack message) works
  // regardless of which host the caller is on. Authorises by org membership only (any
  // member of the report's org may read it). Returns 404 instead of 403 so non-members
  // cannot confirm the report's existence.
  app.get<{ Params: { id: string }; Querystring: { download?: string } }>(
    '/api/reports/:id',
    { preHandler: [requireUser] },
    async (req, reply) => {
      const report = await getConversationReport(app.db, req.params.id);
      if (!report) return reply.code(404).send({ error: 'not found' });

      // Authorise: caller must be a member of the report's org.
      const membership = await getMembership(app.db, report.orgId, req.user!.sub);
      if (!membership) return reply.code(404).send({ error: 'not found' });

      reply.header('content-type', 'text/html; charset=utf-8');
      reply.header('content-security-policy', CSP);
      reply.header('x-content-type-options', 'nosniff');
      if (req.query.download === '1') {
        reply.header('content-disposition', `attachment; filename="report-${report.id}.html"`);
      }
      return reply.send(report.html);
    },
  );

  // List a conversation's reports (newest version first) for the web view.
  app.get<{ Params: { slug: string; cid: string } }>(
    '/api/org/projects/:slug/conversations/:cid/reports',
    projMember,
    async (req) => {
      const reports = await listReportsForConversation(app.db, req.params.cid);
      return reports
        .filter((r) => r.projectId === req.project!.id && r.orgId === req.org!.id)
        .sort((a, b) => b.version - a.version)
        .map((r) => ({ id: r.id, version: r.version, createdAt: r.createdAt }));
    },
  );

  // Latest report-offer status for a conversation, for the live "Generating report…"
  // badge on the conversation view. Returns only the public-safe status fields, and
  // only when the offer belongs to the resolved project/org (same scoping as the list
  // route above) so no cross-tenant status can leak. null when there is no offer.
  app.get<{ Params: { slug: string; cid: string } }>(
    '/api/org/projects/:slug/conversations/:cid/report-offer',
    projMember,
    async (req) => {
      const offer = await getLatestReportOfferForConversation(app.db, req.params.cid);
      if (!offer || offer.projectId !== req.project!.id || offer.orgId !== req.org!.id) return null;
      return {
        id: offer.id,
        status: offer.status,
        reportId: offer.reportId,
        reportUrl: offer.reportUrl,
        error: offer.error,
      };
    },
  );
}
