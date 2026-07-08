import { describe, expect, test } from 'vitest';
import { parseGcpSaKey } from '../src/lib/gcp-key';

describe('parseGcpSaKey', () => {
  test('returns project + account for a valid key', () => {
    const text = JSON.stringify({ type: 'service_account', project_id: 'acme-prod', client_email: 'ro@acme-prod.iam' });
    expect(parseGcpSaKey(text)).toEqual({ ok: true, projectId: 'acme-prod', clientEmail: 'ro@acme-prod.iam' });
  });
  test('rejects non-JSON', () => {
    expect(parseGcpSaKey('nope')).toEqual({ ok: false, error: "That file isn't valid JSON." });
  });
  test('rejects non-service_account', () => {
    const r = parseGcpSaKey(JSON.stringify({ type: 'external_account' }));
    expect(r.ok).toBe(false);
  });
  test('rejects missing fields', () => {
    const r = parseGcpSaKey(JSON.stringify({ type: 'service_account' }));
    expect(r).toEqual({ ok: false, error: 'Key is missing project or account info.' });
  });
});
