import { getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import {
  getAuth, signInWithRedirect, getRedirectResult, SAMLAuthProvider, OAuthProvider,
  type Auth, type AuthProvider,
} from 'firebase/auth';
import { idpConfig } from './firebase-config';

const APP_NAME = 'idp';

/** Firebase Auth for Identity Platform, with authDomain pinned to the CURRENT host
 *  so the signInWithRedirect handler (/__/auth/*) is same-origin (no 3p-cookie break). */
export function getIdpAuth(): Auth {
  const authDomain = window.location.host;
  const existing = getApps().find((a: FirebaseApp) => a.name === APP_NAME);
  const app = existing ?? initializeApp({ ...idpConfig, authDomain }, APP_NAME);
  return getAuth(app);
}

/** Map an Identity Platform provider id to a Firebase AuthProvider. */
export function providerFor(providerId: string): AuthProvider & { providerId: string } {
  if (providerId.startsWith('saml.')) return new SAMLAuthProvider(providerId);
  if (providerId.startsWith('oidc.')) return new OAuthProvider(providerId);
  throw new Error(`unsupported provider: ${providerId}`);
}

/** Begin federated SSO: full-page redirect to the org's IdP. */
export async function startSso(tenantId: string, providerId: string): Promise<void> {
  const auth = getIdpAuth();
  auth.tenantId = tenantId;
  await signInWithRedirect(auth, providerFor(providerId));
}

/** On return from SSO: exchange the Firebase ID token for an app __session.
 *  Returns true if a redirect result was present (and the session was minted). */
export async function completeSsoRedirect(tenantId: string): Promise<boolean> {
  const auth = getIdpAuth();
  auth.tenantId = tenantId; // tenantId does not survive the redirect; restore it.
  const result = await getRedirectResult(auth);
  if (!result) return false;
  const idToken = await result.user.getIdToken();
  const res = await fetch('/auth/session', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error('session exchange failed');
  return true;
}

/** Email/password sign-in via the server (which calls Identity Platform). */
export async function passwordSignIn(email: string, password: string): Promise<void> {
  const res = await fetch('/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  if (res.status === 401) throw new Error('invalid');
  if (!res.ok) throw new Error('signin failed');
}
