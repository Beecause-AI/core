import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startTestDb } from './helpers.js';
import {
  addDynatraceConnection, addDynatraceTarget, updateDynatraceConnection,
  makeDynatraceClientForTest,
} from '@intellilabs/core';
import { dynatraceToolDefs, filterDynatraceToolDefs, callDynatraceTool, SIGNAL_OF } from '../src/integrations/dynatrace/tools.js';

describe('dynatrace tools', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  beforeEach(async () => { t = await startTestDb(); });
  afterEach(async () => { await t.stop(); });

  it('maps tools to signals and gates on availability', () => {
    expect(SIGNAL_OF.error_rate_summary).toBe('metrics');
    expect(SIGNAL_OF.list_problems).toBe('problems');
    const defs = dynatraceToolDefs();
    const filtered = filterDynatraceToolDefs(defs, { hasScope: true, signals: new Set(['problems']) });
    const names = filtered.map((d) => d.name);
    expect(names).toContain('integration.dynatrace.list_scope');       // always shown
    expect(names).toContain('integration.dynatrace.list_problems');    // problems granted
    expect(names).not.toContain('integration.dynatrace.query_metrics'); // metrics not granted
  });

  it('auto-defaults the single target and dispatches list_problems', async () => {
    const conn = await addDynatraceConnection(t.db, { orgId: 'o1', projectId: null, name: 'p', mode: 'api_token', environmentUrl: 'https://x', secretCiphertext: 'c', createdByUserId: 'u1' });
    await updateDynatraceConnection(t.db, 'o1', conn.id, { metadata: { availableSignals: ['problems'] } });
    await addDynatraceTarget(t.db, { projectId: 'p1', connectionId: conn.id, managementZone: 'prod', service: 'checkout', addedByUserId: 'u1' });
    const client = makeDynatraceClientForTest({ async listProblems() { return { problems: [{ problemId: 'P-1' }] }; } });
    const res = await callDynatraceTool({ db: t.db, orgId: 'o1', projectId: 'p1', config: {}, client }, 'integration.dynatrace.list_problems', {});
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('P-1');
  });

  it('rejects a scope not in the project targets', async () => {
    const conn = await addDynatraceConnection(t.db, { orgId: 'o1', projectId: null, name: 'p', mode: 'api_token', environmentUrl: 'https://x', secretCiphertext: 'c', createdByUserId: 'u1' });
    await addDynatraceTarget(t.db, { projectId: 'p1', connectionId: conn.id, managementZone: 'prod', service: 'checkout', addedByUserId: 'u1' });
    const client = makeDynatraceClientForTest();
    const res = await callDynatraceTool({ db: t.db, orgId: 'o1', projectId: 'p1', config: {}, client }, 'integration.dynatrace.query_logs', { managementZone: 'staging', query: 'x' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/not in the configured Dynatrace targets/);
  });
});
