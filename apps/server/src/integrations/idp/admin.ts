/**
 * Identity Platform admin layer — the successor to KcAdmin. Tenant-per-org
 * (createTenant ↔ createRealm) and users created within a tenant. The
 * firebase-admin `Auth` is injected so unit tests use a fake (no network).
 */

/** Subset of firebase-admin's Auth that this module uses. */
export interface IdpAuth {
  tenantManager(): {
    createTenant(opts: {
      displayName: string;
      emailSignInConfig: { enabled: boolean; passwordRequired: boolean };
    }): Promise<{ tenantId: string }>;
    authForTenant(tenantId: string): {
      createUser(props: {
        uid?: string;
        email: string;
        password: string;
        displayName: string;
        emailVerified: boolean;
      }): Promise<{ uid: string }>;
      getUserByEmail(email: string): Promise<{ uid: string; emailVerified: boolean }>;
      updateUser(uid: string, props: { displayName: string }): Promise<unknown>;
      deleteUser(uid: string): Promise<void>;
      createProviderConfig(config: Record<string, unknown>): Promise<{ providerId: string }>;
      listProviderConfigs(opts: { type: 'saml' | 'oidc' }): Promise<{ providerConfigs: Array<{ providerId: string }> }>;
      deleteProviderConfig(providerId: string): Promise<void>;
    };
  };
}

export interface IdpAdmin {
  /** Create the org's tenant with email/password sign-in enabled. */
  createTenant(input: { displayName: string }): Promise<{ tenantId: string }>;
  /** Create a user in the tenant. Pass `uid` to preserve an existing identifier. */
  createUser(
    tenantId: string,
    input: { uid?: string; email: string; password: string; name: string; emailVerified: boolean },
  ): Promise<{ uid: string }>;
  findUserByEmail(tenantId: string, email: string): Promise<{ uid: string; emailVerified: boolean } | null>;
  updateUser(tenantId: string, uid: string, attrs: { firstName: string; lastName: string }): Promise<void>;
  deleteUser(tenantId: string, uid: string): Promise<void>;
  createSamlProvider(tenantId: string, p: { providerId: string; displayName: string; idpEntityId: string; ssoUrl: string; x509Certificates: string[]; rpEntityId: string; callbackUrl: string }): Promise<{ providerId: string }>;
  createOidcProvider(tenantId: string, p: { providerId: string; displayName: string; issuer: string; clientId: string; clientSecret: string }): Promise<{ providerId: string }>;
  listProviders(tenantId: string): Promise<string[]>;
  deleteProvider(tenantId: string, providerId: string): Promise<void>;
}

export class IdpUserExistsError extends Error {
  constructor() {
    super('user already exists');
    this.name = 'IdpUserExistsError';
  }
}

function errCode(e: unknown): string | undefined {
  return typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : undefined;
}

export function makeIdpAdmin(auth: IdpAuth): IdpAdmin {
  return {
    async createTenant({ displayName }) {
      const t = await auth.tenantManager().createTenant({
        displayName,
        emailSignInConfig: { enabled: true, passwordRequired: true },
      });
      return { tenantId: t.tenantId };
    },

    async createUser(tenantId, { uid, email, password, name, emailVerified }) {
      const tenantAuth = auth.tenantManager().authForTenant(tenantId);
      try {
        const u = await tenantAuth.createUser({
          ...(uid ? { uid } : {}),
          email,
          password,
          displayName: name.trim(),
          emailVerified,
        });
        return { uid: u.uid };
      } catch (e) {
        const code = errCode(e);
        if (code === 'auth/email-already-exists' || code === 'auth/uid-already-exists') throw new IdpUserExistsError();
        throw e;
      }
    },

    async findUserByEmail(tenantId, email) {
      const tenantAuth = auth.tenantManager().authForTenant(tenantId);
      try {
        const u = await tenantAuth.getUserByEmail(email);
        return { uid: u.uid, emailVerified: u.emailVerified };
      } catch (e) {
        if (errCode(e) === 'auth/user-not-found') return null;
        throw e;
      }
    },

    async updateUser(tenantId, uid, { firstName, lastName }) {
      const tenantAuth = auth.tenantManager().authForTenant(tenantId);
      await tenantAuth.updateUser(uid, { displayName: `${firstName} ${lastName}`.trim() });
    },

    async deleteUser(tenantId, uid) {
      const tenantAuth = auth.tenantManager().authForTenant(tenantId);
      try {
        await tenantAuth.deleteUser(uid);
      } catch (e) {
        if (errCode(e) === 'auth/user-not-found') return; // already gone — idempotent
        throw e;
      }
    },

    async createSamlProvider(tenantId, p) {
      const a = auth.tenantManager().authForTenant(tenantId);
      const r = await a.createProviderConfig({
        providerId: p.providerId, displayName: p.displayName, enabled: true,
        idpEntityId: p.idpEntityId, ssoURL: p.ssoUrl, x509Certificates: p.x509Certificates,
        rpEntityId: p.rpEntityId, callbackURL: p.callbackUrl,
      });
      return { providerId: r.providerId };
    },

    async createOidcProvider(tenantId, p) {
      const a = auth.tenantManager().authForTenant(tenantId);
      const r = await a.createProviderConfig({
        providerId: p.providerId, displayName: p.displayName, enabled: true,
        issuer: p.issuer, clientId: p.clientId, clientSecret: p.clientSecret, responseType: { code: true },
      });
      return { providerId: r.providerId };
    },

    async listProviders(tenantId) {
      const a = auth.tenantManager().authForTenant(tenantId);
      const [saml, oidc] = await Promise.all([
        a.listProviderConfigs({ type: 'saml' }),
        a.listProviderConfigs({ type: 'oidc' }),
      ]);
      return [...saml.providerConfigs, ...oidc.providerConfigs].map((c) => c.providerId);
    },

    async deleteProvider(tenantId, providerId) {
      const a = auth.tenantManager().authForTenant(tenantId);
      await a.deleteProviderConfig(providerId);
    },
  };
}
