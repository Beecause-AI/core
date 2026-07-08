import type { Db, Organization } from '@intellilabs/core';
import { getUserByEmail, hashPassword, verifyPassword } from '@intellilabs/core';
import { type IdpSignIn, IdpInvalidCredentialsError } from '../integrations/idp/signin.js';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('invalid credentials');
    this.name = 'InvalidCredentialsError';
  }
}

export interface AuthProvider {
  /** Verify email/password; return the user identity or throw InvalidCredentialsError. */
  authenticate(input: { org: Organization; email: string; password: string }): Promise<{ userId: string; email?: string; name?: string }>;
}

/** SaaS: Identity Platform, scoped to the org's tenant. */
export function gcpAuthProvider(signIn: IdpSignIn): AuthProvider {
  return {
    async authenticate({ org, email, password }) {
      if (!org.idpTenantId) throw new InvalidCredentialsError();
      try {
        const r = await signIn(org.idpTenantId, email, password);
        return { userId: r.uid, email: r.email, name: r.name };
      } catch (e) {
        if (e instanceof IdpInvalidCredentialsError) throw new InvalidCredentialsError();
        throw e;
      }
    },
  };
}

// Computed once at module load. Forces scrypt to run even when the email is
// unknown so response time doesn't reveal whether the email exists.
const DUMMY_PASSWORD_HASH = hashPassword('unused-timing-equalizer');

/** OSS: local email/password (scrypt), org-agnostic. */
export function localAuthProvider(db: Db): AuthProvider {
  return {
    async authenticate({ email, password }) {
      const user = await getUserByEmail(db, email);
      // Always run scrypt (dummy hash for unknown users) so response time doesn't
      // reveal whether the email exists.
      const ok = verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
      if (!user || !ok) throw new InvalidCredentialsError();
      return { userId: user.id, email: user.email, name: user.name };
    },
  };
}
