import { initializeApp, getApps, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { IdpAuth } from './admin.js';

const APP_NAME = 'idp';

/** ADC-backed firebase-admin Auth for the Identity Platform project. Memoized
 *  so repeated calls (and tests) reuse one App and one Auth instance.
 *  The memo keys on the fixed App name, not projectId — `projectId` comes from a
 *  single env var (IDP_PROJECT_ID) and never varies at runtime. A second call
 *  with a different projectId would return the first App. */
export function firebaseIdpAuth(projectId: string): IdpAuth {
  const existing = getApps().find((a: App) => a.name === APP_NAME);
  const app = existing ?? initializeApp({ credential: applicationDefault(), projectId }, APP_NAME);
  return getAuth(app) as unknown as IdpAuth;
}
