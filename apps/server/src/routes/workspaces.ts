import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { findOrgsByEmail } from '@intellilabs/core';
import { TokenBucketLimiter } from '../auth/rate-limit.js';

const Body = z.object({ email: z.string().trim().toLowerCase().email().max(254) });

/** Public, unauthenticated: which orgs does this email belong to (marketing /login). */
export async function workspaceRoutes(app: FastifyInstance) {
  const limiter = new TokenBucketLimiter({ capacity: 5, refillPerMs: 5 / 60_000 });

  app.post('/api/auth/workspaces', async (req, reply) => {
    // req.ip is the authoritative client address on both serving paths:
    // - Direct run.app: Cloud Run's Google Front End (GFE) appends the real client
    //   IP to X-Forwarded-For; trustProxy:1 in app.ts resolves req.ip to that value.
    // - Via Cloudflare: Cloudflare appends the real client IP; GFE then appends
    //   Cloudflare's egress IP. trustProxy:1 resolves req.ip to CF's egress IP
    //   (per-CF-exit bucketing, not per-client, but the global CF rate rule covers this).
    // CF-Connecting-IP is intentionally ignored: direct run.app callers can forge it
    // freely, defeating the limiter. req.ip cannot be forged by the client because
    // trustProxy:1 takes the last XFF entry, which is set by the socket-adjacent proxy.
    const ip = req.ip;
    if (!limiter.tryConsume(ip)) {
      return reply.code(429).header('retry-after', '60').send({ error: 'too many requests' });
    }
    const { email } = Body.parse(req.body);
    const orgs = await findOrgsByEmail(app.db, email);
    return { orgs: orgs.map((o) => ({ slug: o.slug, name: o.name })) };
  });
}
