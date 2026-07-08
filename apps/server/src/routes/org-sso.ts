import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getOrgBySlug, setOrgSso } from '@intellilabs/core';
import { requireUser, requireOrgMember, requireOrgAdmin } from '../auth/guard.js';
import { resolveOrg } from '../auth/org-context.js';

const SamlBody = z.object({ type: z.literal('saml'), displayName: z.string().min(1), idpEntityId: z.string().min(1), ssoUrl: z.string().url(), x509Certificate: z.string().min(1) });
const OidcBody = z.object({ type: z.literal('oidc'), displayName: z.string().min(1), issuer: z.string().url(), clientId: z.string().min(1), clientSecret: z.string().min(1) });
const Body = z.discriminatedUnion('type', [SamlBody, OidcBody]);

export async function orgSsoRoutes(app: FastifyInstance) {
  const admin = [resolveOrg, requireUser, requireOrgMember, requireOrgAdmin];
  const apexHost = new URL(app.config.BASE_URL).host;

  app.get('/org/sso', { preHandler: admin }, async (req, reply) => {
    if (!app.idpAdmin || !req.org!.idpTenantId) return reply.code(503).send({ error: 'sso unavailable' });
    const providers = await app.idpAdmin.listProviders(req.org!.idpTenantId);
    return { ssoEnabled: req.org!.ssoEnabled, providers };
  });

  app.post('/org/sso', { preHandler: admin }, async (req, reply) => {
    if (!app.idpAdmin || !req.org!.idpTenantId) return reply.code(503).send({ error: 'sso unavailable' });
    const body = Body.parse(req.body);
    const slug = req.org!.slug;
    const callbackUrl = `https://${slug}.${apexHost}/__/auth/handler`;
    let providerId: string;
    if (body.type === 'saml') {
      providerId = `saml.${slug}`;
      await app.idpAdmin.createSamlProvider(req.org!.idpTenantId, {
        providerId, displayName: body.displayName, idpEntityId: body.idpEntityId, ssoUrl: body.ssoUrl,
        x509Certificates: [body.x509Certificate], rpEntityId: `https://${slug}.${apexHost}`, callbackUrl,
      });
    } else {
      providerId = `oidc.${slug}`;
      await app.idpAdmin.createOidcProvider(req.org!.idpTenantId, {
        providerId, displayName: body.displayName, issuer: body.issuer, clientId: body.clientId, clientSecret: body.clientSecret,
      });
    }
    await setOrgSso(app.db, req.org!.id, { ssoProvider: providerId, ssoEnabled: true });
    return { providerId };
  });

  app.delete('/org/sso', { preHandler: admin }, async (req, reply) => {
    if (!app.idpAdmin || !req.org!.idpTenantId) return reply.code(503).send({ error: 'sso unavailable' });
    const org = await getOrgBySlug(app.db, req.org!.slug);
    if (org?.ssoProvider) await app.idpAdmin.deleteProvider(req.org!.idpTenantId, org.ssoProvider);
    await setOrgSso(app.db, req.org!.id, { ssoProvider: null, ssoEnabled: false });
    return { ok: true };
  });
}
