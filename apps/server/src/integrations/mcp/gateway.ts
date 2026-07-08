/** Minimal MCP-gateway client for the web API. Lists an org's MCP tools via the
 *  gateway's POST /tools/list. The auth-header function is injectable; in prod it mints a
 *  Google ID token (see makeGoogleIdTokenHeader). When no gateway URL is configured,
 *  returns [] so the editor degrades gracefully. */

import { injectTraceHeaders } from '@intellilabs/core';

export type McpTool = { name: string; kind: string; mutates: boolean; description: string };
export type McpListTools = (orgId: string) => Promise<McpTool[]>;
export type AuthHeader = () => Promise<Record<string, string>>;

/** Google ID-token auth header for invoking the IAM-private gateway (Cloud Run validates
 *  the token's audience against the server SA's run.invoker grant). google-auth-library is
 *  imported lazily so non-prod paths (no gateway URL) never load it. Missing GCP creds
 *  (local/test) → no header, which the gateway treats as dev-bypass. Mirrors engine-worker. */
export function makeGoogleIdTokenHeader(audienceUrl: string): AuthHeader {
  return async (): Promise<Record<string, string>> => {
    try {
      const { GoogleAuth } = await import('google-auth-library');
      const client = await new GoogleAuth().getIdTokenClient(audienceUrl);
      const headers = (await client.getRequestHeaders()) as unknown as Record<string, string>;
      const authz = headers.Authorization ?? headers.authorization;
      return authz ? { Authorization: authz } : {};
    } catch {
      return {};
    }
  };
}

async function gatewayListTools(baseUrl: string, getAuth: AuthHeader, orgId: string): Promise<McpTool[]> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(await getAuth()) };
  injectTraceHeaders(headers);
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/tools/list`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ orgId }),
  });
  if (!res.ok) throw new Error(`mcp gateway ${res.status}`);
  const body = (await res.json()) as { tools?: McpTool[] };
  return body.tools ?? [];
}

/** Build a tool-lister. No gatewayUrl → stub returning []. getAuthHeader defaults to
 *  no auth (deploy task injects a Google ID-token header). */
export function makeMcpListTools(gatewayUrl: string | undefined, getAuthHeader: AuthHeader = async () => ({})): McpListTools {
  if (!gatewayUrl) return async () => [];
  return (orgId: string) => gatewayListTools(gatewayUrl, getAuthHeader, orgId);
}
