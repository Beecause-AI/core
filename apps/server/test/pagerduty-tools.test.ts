import { describe, it, expect } from 'vitest';
import { pagerdutyToolDefs, filterPagerDutyToolDefs, callPagerDutyTool } from '../src/integrations/pagerduty/tools.js';
import { makePagerDutyClientForTest } from '@intellilabs/core';

// ── Minimal fake Db for tests ──────────────────────────────────────────────
type FakeDoc = { id: string; [k: string]: unknown };

function fakeDb(collections: Record<string, FakeDoc[]>) {
  const store = new Map<string, FakeDoc[]>();
  for (const [k, v] of Object.entries(collections)) store.set(k, v);
  // The DocStore port's Query.get() resolves to a Snapshot[] (array), not a { docs } wrapper.
  const col = (name: string) => ({
    where: (field: string, op: string, val: unknown) => ({
      where: (f2: string, op2: string, v2: unknown) => ({
        get: async () => {
          const docs = (store.get(name) ?? []).filter((d) => {
            const m1 = op === '==' ? d[field] === val : true;
            const m2 = op2 === '==' ? d[f2] === v2 : true;
            return m1 && m2;
          });
          return docs.map((d) => ({ id: d.id, exists: true, data: () => d }));
        },
      }),
      get: async () => {
        const docs = (store.get(name) ?? []).filter((d) =>
          op === '==' ? d[field] === val : true,
        );
        return docs.map((d) => ({ id: d.id, exists: true, data: () => d }));
      },
    }),
    doc: (id: string) => ({
      get: async () => {
        const docs = store.get(name) ?? [];
        const doc = docs.find((d) => d.id === id);
        return { exists: !!doc, data: () => doc };
      },
    }),
  });
  return { collection: (name: string) => col(name) } as unknown as import('@intellilabs/core').Db;
}

const TARGET = {
  id: 't1',
  projectId: 'proj1',
  connectionId: 'conn1',
  teamId: null,
  teamName: null,
  serviceId: 'S1',
  serviceName: 'checkout',
  label: null,
  metadata: {},
  addedByUserId: 'u1',
  createdAt: new Date(),
};

const CONN = {
  id: 'conn1',
  orgId: 'org1',
  projectId: null,
  name: 'Test PD',
  mode: 'api_keys',
  region: 'us',
  secretCiphertext: 'x',
  secretHint: null,
  metadata: { availableSignals: ['alerts'] },
  enabled: true,
  lastTestedAt: null,
  lastTestOk: true,
  createdByUserId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('pagerduty tool defs', () => {
  it('exposes the 7 incident tools, all read-only', () => {
    const names = pagerdutyToolDefs().map((d) => d.name);
    expect(names).toEqual([
      'integration.pagerduty.list_scope',
      'integration.pagerduty.describe_datasets',
      'integration.pagerduty.list_services',
      'integration.pagerduty.list_incidents',
      'integration.pagerduty.get_incident',
      'integration.pagerduty.list_incident_alerts',
      'integration.pagerduty.list_incident_log_entries',
    ]);
    expect(pagerdutyToolDefs().every((d) => d.mutates === false)).toBe(true);
  });

  it('filters everything out when the project has no scope', () => {
    expect(filterPagerDutyToolDefs(pagerdutyToolDefs(), { hasScope: false, signals: new Set() })).toEqual([]);
  });

  it('keeps list_scope/describe_datasets plus alert tools when scoped', () => {
    const kept = filterPagerDutyToolDefs(pagerdutyToolDefs(), { hasScope: true, signals: new Set(['alerts']) }).map((d) => d.name);
    expect(kept).toContain('integration.pagerduty.list_scope');
    expect(kept).toContain('integration.pagerduty.list_incidents');
  });
});

describe('callPagerDutyTool dispatch', () => {
  it('list_incidents passes target ids + 7d default through to the client', async () => {
    const calls: any[] = [];
    const client = makePagerDutyClientForTest({
      listIncidents: async (_c, p) => { calls.push(p); return { incidents: [] }; },
    });
    const db = fakeDb({ pagerduty_targets: [TARGET], pagerduty_connections: [CONN] });
    await callPagerDutyTool(
      { db, orgId: 'org1', projectId: 'proj1', config: {}, client },
      'integration.pagerduty.list_incidents',
      {},
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].serviceIds).toEqual(['S1']);
    expect(typeof calls[0].since).toBe('string');
    expect(calls[0].since.length).toBeGreaterThan(0);
  });
});
