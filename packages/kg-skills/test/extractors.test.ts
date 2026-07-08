import { describe, it, expect } from 'vitest';
// Importing index registers all 3 skills as side effects.
import { listSkills, skillsFor } from '../src/index.js';

// Obtain skill refs after registration.
const skills = listSkills();
const arch = skills.find((s) => s.id === 'extract-architecture')!;
const flows = skills.find((s) => s.id === 'extract-flows')!;
const deps = skills.find((s) => s.id === 'link-dependencies')!;

// ─── Registry registration ────────────────────────────────────────────────────

describe('skill registration', () => {
  it('registers all 3 skills', () => {
    const ids = skills.map((s) => s.id);
    expect(ids).toContain('extract-architecture');
    expect(ids).toContain('extract-flows');
    expect(ids).toContain('link-dependencies');
  });

  it('extract-architecture is in phase architecture', () => {
    expect(skillsFor('architecture').map((s) => s.id)).toContain('extract-architecture');
  });

  it('extract-flows is in phase flows', () => {
    expect(skillsFor('flows').map((s) => s.id)).toContain('extract-flows');
  });

  it('link-dependencies is in phase dependencies', () => {
    expect(skillsFor('dependencies').map((s) => s.id)).toContain('link-dependencies');
  });
});

// ─── extract-architecture ─────────────────────────────────────────────────────

describe('extract-architecture', () => {
  it('promptFragment returns a non-empty string mentioning the JSON shape', () => {
    const frag = arch.promptFragment!({ summary: 'A project.' });
    expect(typeof frag).toBe('string');
    expect(frag.length).toBeGreaterThan(0);
    expect(frag).toContain('"components"');
    expect(frag).toContain('"files"');
  });

  it('promptFragment includes the area when provided', () => {
    const frag = arch.promptFragment!({ summary: 'A project.', area: 'auth' });
    expect(frag).toContain('auth');
  });

  it('parse returns correct node and edge from canned JSON string', () => {
    const json = '{"components":[{"index":0,"name":"Auth","digest":"Login.","files":["src/auth/login.ts"]}]}';
    const result = arch.parse!(json, { repoFullName: 'o/r' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ kind: 'component', name: 'Auth', digest: 'Login.', repoFullName: 'o/r' });
    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({ srcName: 'Auth', dstName: 'src/auth/login.ts', relation: 'composes' });
  });

  it('parse returns correct node and edge from parsed object', () => {
    const obj = { components: [{ index: 0, name: 'Auth', digest: 'Login.', files: ['src/auth/login.ts'] }] };
    const result = arch.parse!(obj, { repoFullName: 'o/r' });
    expect(result.nodes[0]).toMatchObject({ kind: 'component', name: 'Auth' });
    expect(result.edges[0]).toMatchObject({ relation: 'composes' });
  });

  it('parse handles multiple components and files', () => {
    const json = JSON.stringify({
      components: [
        { index: 0, name: 'Web', digest: 'Frontend.', files: ['src/app.tsx', 'src/pages/home.tsx'] },
        { index: 1, name: 'Api', digest: 'Backend.', files: ['src/server.ts'] },
      ],
    });
    const result = arch.parse!(json, {});
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(3);
    expect(result.edges.filter((e) => e.srcName === 'Web')).toHaveLength(2);
    expect(result.edges.filter((e) => e.srcName === 'Api')).toHaveLength(1);
  });

  it('parse of junk returns empty contribution', () => {
    expect(arch.parse!('not json at all!!!', {})).toEqual({ nodes: [], edges: [] });
    expect(arch.parse!(null, {})).toEqual({ nodes: [], edges: [] });
    expect(arch.parse!(42, {})).toEqual({ nodes: [], edges: [] });
  });

  it('parse sets repoFullName to null when ctx has none', () => {
    const json = '{"components":[{"index":0,"name":"X","digest":"D.","files":[]}]}';
    const result = arch.parse!(json, {});
    expect(result.nodes[0]?.repoFullName).toBeNull();
  });
});

// ─── extract-flows ────────────────────────────────────────────────────────────

describe('extract-flows', () => {
  it('promptFragment returns a non-empty string mentioning the JSON shape', () => {
    const frag = flows.promptFragment!({ summary: 'Components summary.' });
    expect(typeof frag).toBe('string');
    expect(frag.length).toBeGreaterThan(0);
    expect(frag).toContain('"flows"');
    expect(frag).toContain('"components"');
    expect(frag).toContain('"files"');
  });

  it('parse returns flow node + touches + implements_flow edges', () => {
    const json = '{"flows":[{"name":"Checkout","digest":"Buy.","components":["Cart"],"files":["src/pay.ts"]}]}';
    const result = flows.parse!(json, { repoFullName: 'o/r' });
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ kind: 'flow', name: 'Checkout', digest: 'Buy.' });
    expect(result.edges).toHaveLength(2);
    const touchesEdge = result.edges.find((e) => e.relation === 'touches');
    expect(touchesEdge).toMatchObject({ srcName: 'Checkout', dstName: 'Cart', relation: 'touches' });
    const implEdge = result.edges.find((e) => e.relation === 'implements_flow');
    expect(implEdge).toMatchObject({ srcName: 'Checkout', dstName: 'src/pay.ts', relation: 'implements_flow' });
  });

  it('parse handles multiple flows', () => {
    const json = JSON.stringify({
      flows: [
        { name: 'Login', digest: 'Auth.', components: ['Auth', 'DB'], files: ['src/login.ts'] },
        { name: 'Signup', digest: 'Reg.', components: ['Auth'], files: [] },
      ],
    });
    const result = flows.parse!(json, {});
    expect(result.nodes).toHaveLength(2);
    // Login: 2 touches + 1 implements_flow = 3; Signup: 1 touches + 0 = 1
    expect(result.edges).toHaveLength(4);
  });

  it('parse of junk returns empty contribution', () => {
    expect(flows.parse!('bad input', {})).toEqual({ nodes: [], edges: [] });
    expect(flows.parse!(null, {})).toEqual({ nodes: [], edges: [] });
  });
});

// ─── link-dependencies ────────────────────────────────────────────────────────

describe('link-dependencies', () => {
  it('promptFragment returns a non-empty string mentioning the JSON shape', () => {
    const frag = deps.promptFragment!({ summary: 'Arch summary.' });
    expect(typeof frag).toBe('string');
    expect(frag.length).toBeGreaterThan(0);
    expect(frag).toContain('"links"');
    expect(frag).toContain('"dependsOn"');
    expect(frag).toContain('"emits"');
  });

  it('promptFragment instructs the model not to invent telemetry providers and reflects the detected allowlist', () => {
    const frag = deps.promptFragment!({ summary: 'Arch summary.', detectedProviders: ['otel'] });
    expect(frag).toContain('Do NOT invent');
    expect(frag).toContain('CONFIRMED observability providers: otel');
  });

  it('parse returns depends_on + emits edges and target nodes', () => {
    const json = JSON.stringify({
      links: [
        {
          owner: 'Auth',
          dependsOn: [{ kind: 'datastore', name: 'postgres' }],
          emits: [{ kind: 'metric', name: 'login_count', provider: 'otel' }],
        },
      ],
    });
    const result = deps.parse!(json, { repoFullName: 'o/r' });

    // Edges: depends_on + emits
    expect(result.edges).toHaveLength(2);
    const depEdge = result.edges.find((e) => e.relation === 'depends_on');
    expect(depEdge).toMatchObject({ srcName: 'Auth', dstName: 'postgres', relation: 'depends_on' });
    const emitEdge = result.edges.find((e) => e.relation === 'emits');
    expect(emitEdge).toMatchObject({ srcName: 'Auth', dstName: 'login_count', relation: 'emits' });

    // Nodes: postgres (datastore) + login_count (metric with provider)
    expect(result.nodes).toHaveLength(2);
    const pgNode = result.nodes.find((n) => n.name === 'postgres');
    expect(pgNode).toMatchObject({ kind: 'datastore', name: 'postgres' });
    const metricNode = result.nodes.find((n) => n.name === 'login_count');
    expect(metricNode).toMatchObject({ kind: 'metric', name: 'login_count', metadata: { provider: 'otel' } });
  });

  it('deduplicates target nodes within a single parse call', () => {
    const json = JSON.stringify({
      links: [
        { owner: 'A', dependsOn: [{ kind: 'datastore', name: 'postgres' }], emits: [] },
        { owner: 'B', dependsOn: [{ kind: 'datastore', name: 'postgres' }], emits: [] },
      ],
    });
    const result = deps.parse!(json, {});
    expect(result.edges).toHaveLength(2);
    // postgres node should only appear once
    expect(result.nodes.filter((n) => n.name === 'postgres')).toHaveLength(1);
  });

  it('parse of junk returns empty contribution', () => {
    expect(deps.parse!('not json', {})).toEqual({ nodes: [], edges: [] });
    expect(deps.parse!(null, {})).toEqual({ nodes: [], edges: [] });
  });

  it('parse handles external kind dependency without provider on signals', () => {
    const json = JSON.stringify({
      links: [
        {
          owner: 'Payment',
          dependsOn: [{ kind: 'external', name: 'stripe' }],
          emits: [{ kind: 'log', name: 'payment_error' }],
        },
      ],
    });
    const result = deps.parse!(json, {});
    const extNode = result.nodes.find((n) => n.name === 'stripe');
    expect(extNode).toMatchObject({ kind: 'external', name: 'stripe' });
    const logNode = result.nodes.find((n) => n.name === 'payment_error');
    expect(logNode).toMatchObject({ kind: 'log', name: 'payment_error' });
    // No provider means no metadata key for provider
    expect(logNode?.metadata).toBeUndefined();
  });
});
