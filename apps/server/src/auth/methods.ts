import type { FastifyInstance } from 'fastify';

/** Public endpoint: tells the login page which auth flows are available.
 *  Registered unconditionally so the web always gets an answer. */
export async function authMethodsRoutes(app: FastifyInstance) {
  const cfg = app.config;

  app.get('/auth/methods', async (_req, reply) => {
    return reply.send({
      // password = local password form is available (local or gcp backend)
      password: cfg.AUTH_BACKEND !== 'oidc',
      // oidc = our generic OIDC backend (→ /auth/oidc/login)
      oidc: cfg.AUTH_BACKEND === 'oidc',
      // sso = Firebase/GCP SSO (existing flow via IDP_PROJECT_ID)
      sso: !!cfg.IDP_PROJECT_ID,
      // signup = self-serve registration is open
      signup: cfg.AUTH_BACKEND === 'local' && cfg.LOCAL_SIGNUP_ENABLED === 'true',
    });
  });
}
