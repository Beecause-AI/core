export interface GcpAllowed { allowed: Set<string>; unrestricted: boolean }
export type GcpScopeResult = { ok: true } | { ok: false; error: string };

/** A requested GCP project is allowed if the scope is unrestricted or it is in the allow-list. */
export function validateGcpScope(gcpProjectId: string, scope: GcpAllowed): GcpScopeResult {
  if (scope.unrestricted) return { ok: true };
  if (scope.allowed.has(gcpProjectId)) return { ok: true };
  return { ok: false, error: `GCP project ${gcpProjectId} is not in this project's scope` };
}
