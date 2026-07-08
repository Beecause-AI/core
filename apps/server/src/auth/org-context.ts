import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Organization } from '@intellilabs/core';
import type { TenantResolver } from './tenant-resolver.js';

const RESERVED = new Set(['www', 'app', 'auth', 'super', 'webhooks', 'connect', 'send', 'marketing', 'api', 'status', 'docs', 'mail', 'admin']);

/** Org slug from a request host, or null for apex / reserved / foreign hosts. */
export function slugFromHost(host: string | undefined, domain: string): string | null {
  if (!host) return null;
  const h = host.split(',')[0]!.trim().toLowerCase().split(':')[0]!;
  if (h === domain) return null;
  if (!h.endsWith(`.${domain}`)) return null;
  const label = h.slice(0, -(domain.length + 1));
  if (label.includes('.') || RESERVED.has(label)) return null;
  return label;
}

declare module 'fastify' {
  interface FastifyRequest { org: Organization | null }
  interface FastifyInstance { tenantResolver: TenantResolver }
}

/** preHandler: resolve the org via the configured TenantResolver; 400/404 on failure. */
export async function resolveOrg(req: FastifyRequest, reply: FastifyReply) {
  const r = await req.server.tenantResolver.resolve(req);
  if ('error' in r) return reply.code(r.error === 'no-host' ? 400 : 404).send({ error: r.error === 'no-host' ? 'no org host' : 'not found' });
  req.org = r.org;
}
