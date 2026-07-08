import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createBuild,
  insertNodes,
} from '@intellilabs/core';
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runFinalize } from '../src/phases/finalize.js';
import { runPhase, type KgPublisher } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb, selectBuild, selectEmbeddings } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

/** Returns a fake semantic that records embed calls and returns 768-length vectors. */
function fakeSemantic() {
  const embedCalls: string[][] = [];
  return {
    embedCalls,
    llm: async (_orgId: string, _prompt: string) => ({ text: '', inputTokens: 0, outputTokens: 0 }),
    embed: async (_orgId: string, texts: string[]) => {
      embedCalls.push(texts);
      return texts.map((_, i) => Array.from({ length: 768 }, (__, j) => (i + j) * 0.001));
    },
  };
}

/** Seed a build (phase 'finalize', status 'running') with a component + a flow node. */
async function seedBuild(suffix: string) {
  const org = await createOrgWithOwner(t.db, { name: `Fin${suffix}`, slug: `fin-${suffix}`, userId: 'u1' });
  const project = await createProject(t.db, org.id, { name: 'Sys', slug: `finsys-${suffix}` });
  const build = await createBuild(t.db, {
    orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'finalize',
  });
  const [comp, flow] = await insertNodes(t.db, [
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'component', name: 'Auth', digest: 'Auth component.' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'flow', name: 'Login', digest: 'Login flow.', businessFlow: 'User logs in' },
  ]);
  return { orgId: org.id, projectId: project.id, buildId: build.id, compId: comp!.id, flowId: flow!.id };
}

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('runFinalize', () => {
  it('embeds component+flow nodes, marks build done, sets nodesAnalyzed', async () => {
    const seed = await seedBuild('main');
    const semantic = fakeSemantic();

    const deps = {
      db: t.db,
      store: t.store,
      client: {} as any,
      config: {},
      semantic,
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    await runFinalize(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'finalize',
    });

    // Embeddings were created for both nodes.
    const embeddings = await selectEmbeddings(t.db, seed.buildId);
    expect(embeddings).toHaveLength(2);
    const nodeIds = embeddings.map((e) => e.nodeId).sort();
    expect(nodeIds).toContain(seed.compId);
    expect(nodeIds).toContain(seed.flowId);
    expect(embeddings[0]!.embedding).toHaveLength(768);

    // Build is marked done with finishedAt set.
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.status).toBe('done');
    expect(build!.finishedAt).not.toBeNull();
    expect(build!.nodesAnalyzed).toBeGreaterThan(0);

    // embed was called once with both nodes' texts.
    expect(semantic.embedCalls).toHaveLength(1);
    expect(semantic.embedCalls[0]).toHaveLength(2);
  });

  it('is idempotent: running twice yields one embedding per node and status done', async () => {
    const seed = await seedBuild('idem');
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: fakeSemantic(),
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };
    const job: BuildJob = {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'finalize',
    };

    await runFinalize(deps, job);
    await runFinalize(deps, job);

    // Still exactly one embedding per node (no PK conflict or duplicate).
    const embeddings = await selectEmbeddings(t.db, seed.buildId);
    expect(embeddings).toHaveLength(2);

    // Build is still done (second run's finishBuild just re-sets to done).
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.status).toBe('done');
  });

  it('degrades without a semantic backend: no embeddings, but build still marked done', async () => {
    const seed = await seedBuild('nosem');
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: undefined,
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    // Also exercise the run-phase dispatcher wiring.
    await runPhase(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'finalize',
    });

    // No embeddings (no semantic backend).
    const embeddings = await selectEmbeddings(t.db, seed.buildId);
    expect(embeddings).toHaveLength(0);

    // Build is done anyway.
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.status).toBe('done');
    expect(build!.finishedAt).not.toBeNull();
    expect(build!.nodesAnalyzed).toBeGreaterThan(0);
  });
});
