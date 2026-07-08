import { JwtTokenValidation, SimpleCredentialProvider } from 'botframework-connector';
import type { TeamsAuth } from './client.js';

/** Validate an inbound Bot Framework activity's Authorization header. Returns false on any
 *  missing/invalid token. Security-critical — delegated to the official SDK, never hand-rolled.
 *  ⚠️ Live-smoke: confirm JwtTokenValidation.authenticateRequest's argument order against the
 *  installed botframework-connector version before trusting in prod (Task 17). */
export async function authenticateActivity(
  auth: TeamsAuth,
  activity: unknown,
  authHeader: string | undefined,
): Promise<boolean> {
  if (!authHeader) return false;
  try {
    const creds = new SimpleCredentialProvider(auth.appId, auth.appPassword);
    // channelService '' = public Azure cloud.
    await JwtTokenValidation.authenticateRequest(activity as any, authHeader, creds, '');
    return true;
  } catch {
    return false;
  }
}
