export type GcpSignal = 'monitoring' | 'logging' | 'trace' | 'errors';

export type ParsedSaKey =
  | { ok: true; projectId: string; clientEmail: string }
  | { ok: false; error: string };

/** Parse + validate a GCP service-account JSON key string (client-side). */
export function parseGcpSaKey(text: string): ParsedSaKey {
  let obj: { type?: string; project_id?: string; client_email?: string };
  try { obj = JSON.parse(text); } catch { return { ok: false, error: "That file isn't valid JSON." }; }
  if (obj.type !== 'service_account') {
    return { ok: false, error: 'That looks like a different kind of key — upload the service-account JSON key, or use Workload Identity.' };
  }
  if (!obj.project_id || !obj.client_email) return { ok: false, error: 'Key is missing project or account info.' };
  return { ok: true, projectId: obj.project_id, clientEmail: obj.client_email };
}
