import type { FastifyRequest } from 'fastify';
import { getOrgBySlug, type Organization, type Db } from '@intellilabs/core';
import { slugFromHost } from './org-context.js';

export interface TenantResolver {
  /** Resolve the request's org. Returns null for "no org host" (400) vs throwing for "not found" (404). */
  resolve(req: FastifyRequest): Promise<{ org: Organization } | { error: 'no-host' } | { error: 'not-found' }>;
}

/** Multi-tenant (SaaS): org from the forwarded-host subdomain. */
export function subdomainTenantResolver(deps: { db: Db; baseUrl: string }): TenantResolver {
  const domain = new URL(deps.baseUrl).hostname;
  return {
    async resolve(req) {
      const slug = slugFromHost(req.headers['x-forwarded-host'] as string | undefined, domain);
      if (!slug) return { error: 'no-host' };
      const org = await getOrgBySlug(deps.db, slug);
      if (!org || org.status !== 'active') return { error: 'not-found' };
      return { org };
    },
  };
}

/** Single-tenant (OSS): always the one seeded org, host ignored. */
export function singleTenantResolver(load: () => Promise<Organization | null>): TenantResolver {
  return {
    async resolve() {
      const org = await load();
      return org ? { org } : { error: 'not-found' };
    },
  };
}
