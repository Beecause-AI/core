import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createBuild,
  insertNodes,
  insertEdges,
} from '@intellilabs/core';
// Importing the package registers the extract-flows skill in the registry.
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runFlows } from '../src/phases/flows.js';
import { runPhase, type KgPublisher } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb, selectNodes, selectEdges, selectBuild } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

// A fake LLM returning a canned flow JSON. The 'Checkout' flow touches both seeded
// components and is implemented by the login file (so we can assert merge + resolution).
function fakeSemantic() {
  const calls: string[] = [];
  return {
    calls,
    llm: async (_orgId: string, prompt: string) => {
      calls.push(prompt);
      const text = JSON.stringify({
        flows: [
          { name: 'Checkout', digest: 'Buy something.', components: ['Auth', 'Payments'], files: ['src/auth/login.ts'] },
        ],
      });
      return { text, inputTokens: 10, outputTokens: 5 };
    },
    embed: async () => [],
  };
}

/** Seed a project build (phase 'flows') with 2 components + composed files. */
async function seedBuild(suffix: string) {
  const org = await createOrgWithOwner(t.db, { name: `Flow${suffix}`, slug: `flow-${suffix}`, userId: 'u1' });
  const project = await createProject(t.db, org.id, { name: 'Sys', slug: `flowsys-${suffix}` });
  const build = await createBuild(t.db, {
    orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'flows',
  });
  const [auth, payments, loginFile, chargeFile] = await insertNodes(t.db, [
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'component', name: 'Auth', digest: 'Auth.' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/web', kind: 'component', name: 'Payments', digest: 'Pay.' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'file', name: 'src/auth/login.ts', commitSha: 'c1' },
    { orgId: org.id, buildId: build.id, repoFullName: 'acme/web', kind: 'file', name: 'src/pay/charge.ts', commitSha: 'c1' },
  ]);
  await insertEdges(t.db, [
    { orgId: org.id, buildId: build.id, srcNodeId: auth!.id, dstNodeId: loginFile!.id, relation: 'composes' },
    { orgId: org.id, buildId: build.id, srcNodeId: payments!.id, dstNodeId: chargeFile!.id, relation: 'composes' },
  ]);
  return { orgId: org.id, projectId: project.id, buildId: build.id, authId: auth!.id, paymentsId: payments!.id, loginFileId: loginFile!.id };
}

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('runFlows', () => {
  it('merges flows across components, persists touches + implements_flow edges, meters tokens, advances to dependencies', async () => {
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

    await runFlows(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'flows',
    });

    // One merged flow node (the model returned the same Checkout flow per component).
    const flows = await selectNodes(t.db, seed.buildId, 'flow');
    expect(flows.map((f) => f.name)).toEqual(['Checkout']);
    const checkout = flows[0]!;
    expect(checkout.digest).toBe('Buy something.');
    // touched two repos → '(project)'
    expect(checkout.repoFullName).toBe('(project)');

    // touches edges → both components; implements_flow → login file.
    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: checkout.id });
    const touches = edges.filter((e) => e.relation === 'touches').map((e) => e.dstNodeId).sort();
    expect(touches).toEqual([seed.authId, seed.paymentsId].sort());
    const impl = edges.filter((e) => e.relation === 'implements_flow').map((e) => e.dstNodeId);
    expect(impl).toEqual([seed.loginFileId]);

    // phase advanced + enqueued + tokens metered.
    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('dependencies');
    expect(build!.tokens).toBe((10 + 5) * 2); // one call per component
    const last = localPublished[localPublished.length - 1]!;
    expect(last.phase).toBe('dependencies');
    expect(last.buildId).toBe(seed.buildId);
  });

  it('is idempotent: running twice yields exactly one flow + no duplicate edges', async () => {
    const seed = await seedBuild('idem');
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: fakeSemantic(),
      kgPublisher: { publish: async () => {} } as KgPublisher,
      skills: { skillsFor, listSkills },
    };
    const job: BuildJob = {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'flows',
    };

    await runFlows(deps, job);
    await runFlows(deps, job);

    const flows = await selectNodes(t.db, seed.buildId, 'flow');
    expect(flows).toHaveLength(1);

    const edges = await selectEdges(t.db, seed.buildId, { srcNodeId: flows[0]!.id });
    // 2 touches + 1 implements_flow, no duplicates
    expect(edges.filter((e) => e.relation === 'touches')).toHaveLength(2);
    expect(edges.filter((e) => e.relation === 'implements_flow')).toHaveLength(1);
  });

  it('degrades without a semantic backend: no flows, still advances to dependencies', async () => {
    const seed = await seedBuild('nosem');
    const localPublished: BuildJob[] = [];
    const deps = {
      db: t.db, store: t.store, client: {} as any, config: {}, semantic: undefined,
      kgPublisher: { publish: async (j) => { localPublished.push(j); } } as KgPublisher,
      skills: { skillsFor, listSkills },
    };

    // also exercise the run-phase dispatcher wiring for 'flows'.
    await runPhase(deps, {
      orgId: seed.orgId, projectId: seed.projectId, repoFullName: '(project)', ref: '', mode: 'manual',
      buildId: seed.buildId, phase: 'flows',
    });

    const flows = await selectNodes(t.db, seed.buildId, 'flow');
    expect(flows).toHaveLength(0);

    const build = await selectBuild(t.db, { id: seed.buildId });
    expect(build!.phase).toBe('dependencies');
    expect(localPublished[localPublished.length - 1]!.phase).toBe('dependencies');
  });
});
