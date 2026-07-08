import { describe, expect, it } from 'vitest';
import { probeSignals, type GcpClient } from '@intellilabs/core';

function clientWith(behavior: Record<string, 'ok' | number>): GcpClient {
  const make = (key: string) => async () => {
    const b = behavior[key];
    if (b === 'ok') return { ok: true };
    throw new Error(`GCP ${b}: forbidden`);
  };
  return {
    listMetricDescriptors: make('monitoring'),
    queryLogs: make('logging'),
    listTraces: make('trace'),
    queryMetrics: make('monitoring'),
    getTrace: make('trace'),
    listErrorGroups: make('errors'),
    getErrorGroup: make('errors'),
  } as unknown as GcpClient;
}

describe('probeSignals', () => {
  it('reports all ok', async () => {
    const r = await probeSignals(clientWith({ monitoring: 'ok', logging: 'ok', trace: 'ok', errors: 'ok' }), 'tok', 'acme-prod');
    expect(r.monitoring.ok && r.logging.ok && r.trace.ok && r.errors.ok).toBe(true);
  });

  it('marks a 403 signal not-ok with a role hint', async () => {
    const r = await probeSignals(clientWith({ monitoring: 'ok', logging: 403, trace: 'ok', errors: 'ok' }), 'tok', 'acme-prod');
    expect(r.monitoring.ok).toBe(true);
    expect(r.logging.ok).toBe(false);
    expect(r.logging.error).toMatch(/logging\.viewer/);
    expect(r.trace.ok).toBe(true);
  });

  it('marks a 403 errors signal not-ok with the errorreporting.viewer hint', async () => {
    const r = await probeSignals(clientWith({ monitoring: 'ok', logging: 'ok', trace: 'ok', errors: 403 }), 'tok', 'acme-prod');
    expect(r.errors.ok).toBe(false);
    expect(r.errors.error).toMatch(/errorreporting\.viewer/);
  });
});
