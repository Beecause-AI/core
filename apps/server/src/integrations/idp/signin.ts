/**
 * Server-side password sign-in against GCP Identity Platform. We call Google
 * directly over TLS with the project Web API key, so the returned token is
 * trusted without re-verifying its signature. fetcher is injected for testing.
 */
export interface IdpSignInResult {
  uid: string;
  email?: string;
  name?: string;
  idToken: string;
}

/** (tenantId, email, password) → signed-in user. Throws IdpInvalidCredentialsError on bad creds. */
export type IdpSignIn = (tenantId: string, email: string, password: string) => Promise<IdpSignInResult>;

export class IdpInvalidCredentialsError extends Error {
  constructor() {
    super('invalid credentials');
    this.name = 'IdpInvalidCredentialsError';
  }
}

export function makeIdpSignIn(apiKey: string, fetcher: typeof fetch = fetch): IdpSignIn {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  return async (tenantId, email, password) => {
    const res = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true, tenantId }),
    });
    // 400 covers EMAIL_NOT_FOUND / INVALID_PASSWORD / INVALID_LOGIN_CREDENTIALS — all "bad creds" to the caller.
    if (res.status === 400) throw new IdpInvalidCredentialsError();
    if (!res.ok) throw new Error(`idp signIn → ${res.status}`);
    const j = (await res.json()) as { localId: string; email?: string; displayName?: string; idToken: string };
    return { uid: j.localId, email: j.email, ...(j.displayName ? { name: j.displayName } : {}), idToken: j.idToken };
  };
}
