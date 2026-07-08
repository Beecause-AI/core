import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createBuild,
  insertNodes,
} from '@intellilabs/core';
// Importing the package registers the extract-architecture skill in the registry.
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runArchitecture } from '../src/phases/architecture.js';
import { runPhase, type KgPublisher } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb, selectNodes, selectEdges, selectBuild } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

// A fake LLM that returns, per call, a single component referencing the area's file.
// The prompt embeds the area's file list, so we key the canned response off whichever
// known file path appears in the prompt.
function fakeSemantic() {
  const calls: string[] = [];
  const responses: Record<string, { name: string; digest: string; files: string[] }> = {
    'src/auth/login.ts': { name: 'Auth', digest: 'Login.', files: ['src/auth/login.ts'] },
    'src/pay/charge.ts': { name: 'Payments', digest: 'Charge.', files: ['src/pay/charge.ts'] },
  };
  return {
    calls,
    llm: async (_orgId: string, prompt: string) => {
      calls.push(prompt);
      const hit = Object.keys(responses).find((p) => prompt.includes(p));
      const comp = hit ? responses[hit]! : { name: 'Unknown', digest: '', files: [] };
      const text = JSON.stringify({ components: [{ index: 0, ...comp }] });
      return { text, inputTokens: 10, outputTokens: 5 };
    },
    embed: async () => [],
  };
}

/** Seed a fresh project build (phase 'architecture') with file nodes across 2 repos/areas. */
async function seedBuild(suffix: string) {
  const org = await createOrgWithOwner(t.db, { name: `Arch${suffix}`, slug: `arch-${suffix}`, userId: 'u1' });
  const project = await createProject(t.db, org.id, { name: 'Sys', slug: `sys-${suffix}` });
  const build = await createBuild(t.db, {
    orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'architecture',
  });
  await insertNodes(t.db, [
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'file', name: 'src/auth/login.ts', commitSha: 'c1' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'module', name: 'src/auth', commitSha: 'c1' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/web', kind: 'file', name: 'src/pay/charge.ts', commitSha: 'c1' },
  ]);
  return { orgId: org.id, projectId: project.id, buildId: build.id };
}

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('runArchitecture', () => {
  it('fans out per area, persists merged component nodes + composes edges, and enqueues flows', async () => {
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

    await runArchitecture(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'architecture',
    });

    const nodes = await selectNodes(t.db, seed.buildId, 'component');
    const names = nodes.map((n) => n.name).sort();
    expect(names).toEqual(['Auth', 'Payments']);

    // single-repo components carry their repoFullName.
    const auth = nodes.find((n) => n.name === 'Auth')!;
    expect(auth.repoFullName).toBe('acme/api');
    expect(auth.digest).toBe('Login.');

    // composes edges point from each component to the right file node.
    const fileNodes = await selectNodes(t.db, seed.buildId, 'file');
    const loginFile = fileNodes.find((n) => n.name === 'src/auth/login.ts')!;
    const edges = await selectEdges(t.db, seed.buildId, { relation: 'composes' });
    const authEdge = edges.find((e) => e.srcNodeId === auth.id)!;
    expect(authEdge.dstNodeId).toBe(loginFile.id);
    expect(edges).toHaveLength(2);

    // phase advanced to flows + enqueued.
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('flows');
    const last = localPublished[localPublished.length - 1]!;
    expect(last.phase).toBe('flows');
    expect(last.buildId).toBe(seed.buildId);
  });

  it('is idempotent: running twice yields exactly the expected component nodes (no duplicates)', async () => {
    const seed = await seedBuild('idem');
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: fakeSemantic(),
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };
    const job: BuildJob = {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'architecture',
    };

    await runArchitecture(deps, job);
    await runArchitecture(deps, job);

    const nodes = await selectNodes(t.db, seed.buildId, 'component');
    expect(nodes.map((n) => n.name).sort()).toEqual(['Auth', 'Payments']);

    const edges = await selectEdges(t.db, seed.buildId, { relation: 'composes' });
    expect(edges).toHaveLength(2);
  });

  it('degrades gracefully without a semantic backend: no components, still advances + enqueues flows', async () => {
    const seed = await seedBuild('nosem');
    const localPublished: BuildJob[] = [];
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: undefined,
      kgPublisher: { publish: async (j) => { localPublished.push(j); } } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    // also exercise the run-phase dispatcher wiring for 'architecture'.
    await runPhase(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'architecture',
    });

    const nodes = await selectNodes(t.db, seed.buildId, 'component');
    expect(nodes).toHaveLength(0);

    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('flows');
    expect(localPublished[localPublished.length - 1]!.phase).toBe('flows');
  });
});
