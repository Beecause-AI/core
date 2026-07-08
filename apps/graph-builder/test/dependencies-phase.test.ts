import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createBuild,
  insertNodes,
} from '@intellilabs/core';
// Importing the package registers the link-dependencies skill in the registry.
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runDependencies } from '../src/phases/dependencies.js';
import { runPhase, type KgPublisher } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb, selectNodes, selectEdges, selectBuild } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

// A fake LLM mapping the seeded component to the EXISTING PostgreSQL datastore
// (must reuse, not duplicate) and emitting a NEW metric signal.
function fakeSemantic() {
  const calls: string[] = [];
  return {
    calls,
    llm: async (_orgId: string, prompt: string) => {
      calls.push(prompt);
      const text = JSON.stringify({
        links: [
          {
            owner: 'Api',
            dependsOn: [{ kind: 'datastore', name: 'PostgreSQL' }],
            emits: [{ kind: 'metric', name: 'req_count', provider: 'otel' }],
          },
        ],
      });
      return { text, inputTokens: 10, outputTokens: 5 };
    },
    embed: async () => [],
  };
}

/**
 * Seed a project build (phase 'dependencies') with a component, a detector Postgres
 * datastore, and a detector OTel trace node (so `otel` is a CONFIRMED telemetry provider).
 */
async function seedBuild(suffix: string) {
  const org = await createOrgWithOwner(t.db, { name: `Dep${suffix}`, slug: `dep-${suffix}`, userId: 'u1' });
  const project = await createProject(t.db, org.id, { name: 'Sys', slug: `depsys-${suffix}` });
  const build = await createBuild(t.db, {
    orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'dependencies',
  });
  const [comp, datastore, trace] = await insertNodes(t.db, [
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'component', name: 'Api', digest: 'API.' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'datastore', name: 'PostgreSQL', metadata: { provider: 'postgres' } },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'trace', name: 'http.server', metadata: { provider: 'otel' } },
  ]);
  return { orgId: org.id, projectId: project.id, buildId: build.id, compId: comp!.id, datastoreId: datastore!.id, traceId: trace!.id };
}

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('runDependencies', () => {
  it('reuses the detector datastore (no dup), creates a new signal node, meters tokens, advances to finalize', async () => {
    const seed = await seedBuild('main');
    const semantic = fakeSemantic();
    const localPublished: BuildJob[] = [];

    const deps = {
      db: t.db,
      store: t.store,
      client: {} as any,
      config: {},
      semantic,
      kgPublisher: { publish: async (j) => { localPublished.push(j); } } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    await runDependencies(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'dependencies',
    });

    // Exactly ONE PostgreSQL datastore (reused, not duplicated).
    const datastores = await selectNodes(t.db, seed.buildId, 'datastore');
    expect(datastores).toHaveLength(1);
    expect(datastores[0]!.id).toBe(seed.datastoreId);

    // A NEW metric node was created.
    const metrics = await selectNodes(t.db, seed.buildId, 'metric');
    expect(metrics.map((m) => m.name)).toEqual(['req_count']);
    const metric = metrics[0]!;

    // depends_on edge → existing PostgreSQL node; emits edge → new metric node.
    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: seed.compId });
    const dependsOn = edges.filter((e) => e.relation === 'depends_on');
    expect(dependsOn).toHaveLength(1);
    expect(dependsOn[0]!.dstNodeId).toBe(seed.datastoreId);
    const emits = edges.filter((e) => e.relation === 'emits');
    expect(emits).toHaveLength(1);
    expect(emits[0]!.dstNodeId).toBe(metric.id);

    // phase advanced + enqueued + tokens metered.
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('finalize');
    expect(build!.tokens).toBe(10 + 5);
    const last = localPublished[localPublished.length - 1]!;
    expect(last.phase).toBe('finalize');
    expect(last.buildId).toBe(seed.buildId);
  });

  it('grounds telemetry to detected providers (creates OTel, drops Prometheus) and flags inferred external deps', async () => {
    const seed = await seedBuild('ground');
    const localPublished: BuildJob[] = [];

    // Mapper returns: a CONFIRMED OTel metric (create), a Prometheus metric (DROP),
    // depends_on the existing Postgres (reuse, no dup), and depends_on a new external
    // 'Keycloak' (not detected → create flagged inferred:true).
    const semantic = {
      llm: async () => ({
        text: JSON.stringify({
          links: [
            {
              owner: 'Api',
              dependsOn: [
                { kind: 'datastore', name: 'PostgreSQL' },
                { kind: 'external', name: 'Keycloak' },
              ],
              emits: [
                { kind: 'metric', name: 'req_count', provider: 'otel' },
                { kind: 'metric', name: 'scrape_count', provider: 'prometheus' },
              ],
            },
          ],
        }),
        inputTokens: 10,
        outputTokens: 5,
      }),
      embed: async () => [],
    };

    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic,
      kgPublisher: { publish: async (j) => { localPublished.push(j); } } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    await runDependencies(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'dependencies',
    });

    // OTel metric (confirmed provider) was CREATED; Prometheus metric was DROPPED.
    const metrics = await selectNodes(t.db, seed.buildId, 'metric');
    expect(metrics.map((m) => m.name)).toEqual(['req_count']);
    const otelMetric = metrics[0]!;

    // No Prometheus node of any kind leaked in.
    const allNodes = await selectNodes(t.db, seed.buildId);
    expect(allNodes.some((n) => n.name === 'scrape_count')).toBe(false);

    // Existing Postgres reused (no dup); new external Keycloak created flagged inferred.
    const datastores = allNodes.filter((n) => n.kind === 'datastore');
    expect(datastores).toHaveLength(1);
    expect(datastores[0]!.id).toBe(seed.datastoreId);
    const externals = allNodes.filter((n) => n.kind === 'external');
    expect(externals.map((e) => e.name)).toEqual(['Keycloak']);
    expect((externals[0]!.metadata as Record<string, unknown>)?.['inferred']).toBe(true);

    // Edges: depends_on Postgres + Keycloak; emits OTel metric only (no Prometheus edge).
    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: seed.compId });
    const dependsOn = edges.filter((e) => e.relation === 'depends_on');
    expect(dependsOn.map((e) => e.dstNodeId).sort()).toEqual([seed.datastoreId, externals[0]!.id].sort());
    const emits = edges.filter((e) => e.relation === 'emits');
    expect(emits).toHaveLength(1);
    expect(emits[0]!.dstNodeId).toBe(otelMetric.id);
  });

  it('is idempotent: running twice yields no duplicate edges or target nodes', async () => {
    const seed = await seedBuild('idem');
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: fakeSemantic(),
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };
    const job: BuildJob = {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'dependencies',
    };

    await runDependencies(deps, job);
    await runDependencies(deps, job);

    // still exactly one datastore + one metric
    const datastores = await selectNodes(t.db, seed.buildId, 'datastore');
    expect(datastores).toHaveLength(1);
    const metrics = await selectNodes(t.db, seed.buildId, 'metric');
    expect(metrics).toHaveLength(1);

    // still exactly one depends_on + one emits edge
    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: seed.compId });
    expect(edges.filter((e) => e.relation === 'depends_on')).toHaveLength(1);
    expect(edges.filter((e) => e.relation === 'emits')).toHaveLength(1);
  });

  it('degrades without a semantic backend: no links, still advances to finalize', async () => {
    const seed = await seedBuild('nosem');
    const localPublished: BuildJob[] = [];
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: undefined,
      kgPublisher: { publish: async (j) => { localPublished.push(j); } } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    // also exercise the run-phase dispatcher wiring for 'dependencies'.
    await runPhase(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'dependencies',
    });

    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: seed.compId });
    expect(edges).toHaveLength(0);
    // detector datastore untouched
    const datastores = await selectNodes(t.db, seed.buildId, 'datastore');
    expect(datastores).toHaveLength(1);

    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('finalize');
    expect(localPublished[localPublished.length - 1]!.phase).toBe('finalize');
  });
});
