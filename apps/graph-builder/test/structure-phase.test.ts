import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  addProjectRepo,
  createBuild,
  upsertIntegration,
  getIntegration,
  encryptSecret,
} from '@intellilabs/core';
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runPhase, type KgPublisher } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb, selectNodes, selectEdges, selectBuild } from './helpers.js';

/** Seed a GitHub PAT integration and return its id (mirrors the old insert().returning()). */
async function seedGithubIntegration(db: Parameters<typeof getIntegration>[0], orgId: string, secret: string, userId: string): Promise<string> {
  await upsertIntegration(db, {
    orgId, provider: 'github', mode: 'pat',
    secretCiphertext: encryptSecret(secret, Buffer.alloc(32, 1)), metadata: {}, connectedByUserId: userId,
  });
  const integ = await getIntegration(db, orgId, 'github');
  return integ!.id;
}

let t: Awaited<ReturnType<typeof startTestDb>>;
let orgId: string;
let projectId: string;

// Per-repo in-memory file trees. repo-a has a package.json depending on `pg` so the
// detect-postgres detector fires; both repos contribute distinct `file` nodes.
const TREES: Record<string, { path: string; content: string }[]> = {
  'acme/repo-a': [
    { path: 'package.json', content: JSON.stringify({ dependencies: { pg: '^8' } }) },
    { path: 'src/a-checkout.ts', content: "import './a-pay';" },
    { path: 'src/a-pay.ts', content: 'export {};' },
  ],
  'acme/repo-b': [
    { path: 'lib/b-index.ts', content: 'export const b = 1;' },
  ],
};

const client = {
  getRefInfo: async () => ({ ref: 'main', sha: 'c0ffee' }),
  listTree: async (_c: any, repo: string) => ({
    truncated: false,
    entries: (TREES[repo] ?? []).map((f, i) => ({ path: f.path, type: 'blob', sha: String(i), size: f.content.length })),
  }),
  getFile: async (_c: any, repo: string, path: string) => {
    const f = (TREES[repo] ?? []).find((x) => x.path === path);
    return { text: f?.content ?? '', sha: 'x' };
  },
} as any;

const published: BuildJob[] = [];
const kgPublisher: KgPublisher = { publish: async (job) => { published.push(job); } };

beforeAll(async () => {
  t = await startTestDb();
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme-struct', userId: 'u1' });
  orgId = org.id;

  const integId = await seedGithubIntegration(t.db, orgId, 'ghp_x', 'u1');

  const project = await createProject(t.db, orgId, { name: 'Sys', slug: 'sys' });
  projectId = project.id;

  for (const repoFullName of ['acme/repo-a', 'acme/repo-b']) {
    await addProjectRepo(t.db, {
      projectId, orgIntegrationId: integId, repoFullName,
      defaultBranch: 'main', addedByUserId: 'u1',
    });
  }
});
afterAll(async () => { await t.stop(); });

describe('runStructure (via runPhase dispatcher)', () => {
  it('builds multi-repo structure, runs detectors, and enqueues architecture', async () => {
    const deps = {
      db: t.db,
      store: t.store,
      client,
      config: { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
      kgPublisher,
      skills: { skillsFor, listSkills },
    };

    await runPhase(deps, {
      orgId, projectId, repoFullName: '(project)', ref: '', mode: 'manual', phase: 'structure',
    });

    // A running build advanced to phase 'architecture'.
    const build = await selectBuild(t.db, { orgId, projectId });
    expect(build, 'build row must exist').toBeDefined();
    expect(build!.status).toBe('running');
    expect(build!.phase).toBe('architecture');

    const nodes = await selectNodes(t.db, build!.id);

    // file nodes from BOTH repos, tagged with their repoFullName.
    const fileA = nodes.find((n) => n.kind === 'file' && n.name === 'src/a-checkout.ts');
    const fileB = nodes.find((n) => n.kind === 'file' && n.name === 'lib/b-index.ts');
    expect(fileA, 'repo-a file node').toBeDefined();
    expect(fileB, 'repo-b file node').toBeDefined();
    expect(fileA!.repoFullName).toBe('acme/repo-a');
    expect(fileB!.repoFullName).toBe('acme/repo-b');

    // detect-postgres produced a datastore node.
    const pg = nodes.find((n) => n.kind === 'datastore' && n.name === 'PostgreSQL');
    expect(pg, 'PostgreSQL datastore node').toBeDefined();
    expect((pg!.metadata as Record<string, unknown>)?.provider).toBe('postgres');

    // next phase enqueued with same buildId.
    const last = published[published.length - 1]!;
    expect(last.phase).toBe('architecture');
    expect(last.buildId).toBe(build!.id);
    expect(last.projectId).toBe(projectId);
  });
});

// ---------------------------------------------------------------------------
// Multi-repo path collision: two repos sharing a file path (src/index.ts).
// Before the fix, both imports edges resolved to whichever node was stored last
// in the flat (kind,name) map, potentially crossing repo boundaries.
// ---------------------------------------------------------------------------
describe('runStructure — per-repo path collision', () => {
  // Each repo has src/index.ts importing src/helper.ts. Identical paths, different
  // repo ownership. The imports edges must stay within each repo.
  const COLLISION_TREES: Record<string, { path: string; content: string }[]> = {
    'collision/repo-x': [
      { path: 'src/index.ts', content: "import './helper';" },
      { path: 'src/helper.ts', content: 'export const x = 1;' },
    ],
    'collision/repo-y': [
      { path: 'src/index.ts', content: "import './helper';" },
      { path: 'src/helper.ts', content: 'export const y = 2;' },
    ],
  };

  const collisionClient = {
    getRefInfo: async () => ({ ref: 'main', sha: 'deadbeef' }),
    listTree: async (_c: unknown, repo: string) => ({
      truncated: false,
      entries: (COLLISION_TREES[repo] ?? []).map((f, i) => ({
        path: f.path, type: 'blob', sha: String(i), size: f.content.length,
      })),
    }),
    getFile: async (_c: unknown, repo: string, path: string) => {
      const f = (COLLISION_TREES[repo] ?? []).find((x) => x.path === path);
      return { text: f?.content ?? '', sha: 'x' };
    },
  } as any;

  let collisionDb: Awaited<ReturnType<typeof startTestDb>>;
  let collisionOrgId: string;
  let collisionProjectId: string;
  const collisionPublished: BuildJob[] = [];
  const collisionPublisher: KgPublisher = { publish: async (job) => { collisionPublished.push(job); } };

  beforeAll(async () => {
    collisionDb = await startTestDb();
    const org = await createOrgWithOwner(collisionDb.db, { name: 'Collision', slug: 'collision-org', userId: 'u2' });
    collisionOrgId = org.id;

    const integId = await seedGithubIntegration(collisionDb.db, collisionOrgId, 'ghp_y', 'u2');

    const project = await createProject(collisionDb.db, collisionOrgId, { name: 'CollisionSys', slug: 'collision-sys' });
    collisionProjectId = project.id;

    for (const repoFullName of ['collision/repo-x', 'collision/repo-y']) {
      await addProjectRepo(collisionDb.db, {
        projectId: collisionProjectId, orgIntegrationId: integId, repoFullName,
        defaultBranch: 'main', addedByUserId: 'u2',
      });
    }
  });
  afterAll(async () => { await collisionDb.stop(); });

  it('creates two distinct file nodes for same-path files and keeps imports edges within each repo', async () => {
    const deps = {
      db: collisionDb.db,
      store: collisionDb.store,
      client: collisionClient,
      config: { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
      kgPublisher: collisionPublisher,
      skills: { skillsFor, listSkills },
    };

    await runPhase(deps, {
      orgId: collisionOrgId, projectId: collisionProjectId,
      repoFullName: '(project)', ref: '', mode: 'manual', phase: 'structure',
    });

    const build = await selectBuild(collisionDb.db, { orgId: collisionOrgId, projectId: collisionProjectId });
    expect(build, 'build row must exist').toBeDefined();

    const buildId = build!.id;
    const allNodes = await selectNodes(collisionDb.db, buildId);

    // There must be exactly two file nodes named 'src/index.ts' — one per repo.
    const indexNodes = allNodes.filter((n) => n.kind === 'file' && n.name === 'src/index.ts');
    expect(indexNodes).toHaveLength(2);
    const indexRepos = new Set(indexNodes.map((n) => n.repoFullName));
    expect(indexRepos).toContain('collision/repo-x');
    expect(indexRepos).toContain('collision/repo-y');

    // Similarly two helper nodes.
    const helperNodes = allNodes.filter((n) => n.kind === 'file' && n.name === 'src/helper.ts');
    expect(helperNodes).toHaveLength(2);

    // Check imports edges: each index→helper edge must stay within the same repo.
    const allEdges = await selectEdges(collisionDb.db, buildId, { relation: 'imports' });

    for (const edge of allEdges) {
      const src = allNodes.find((n) => n.id === edge.srcNodeId);
      const dst = allNodes.find((n) => n.id === edge.dstNodeId);
      expect(src, 'edge src node must exist').toBeDefined();
      expect(dst, 'edge dst node must exist').toBeDefined();
      expect(src!.repoFullName).toBe(dst!.repoFullName);
    }

    // Specifically: repo-x's index imports repo-x's helper (not repo-y's).
    const idxX = indexNodes.find((n) => n.repoFullName === 'collision/repo-x')!;
    const helpX = helperNodes.find((n) => n.repoFullName === 'collision/repo-x')!;
    const edgeX = allEdges.find((e) => e.srcNodeId === idxX.id);
    expect(edgeX, 'repo-x imports edge must exist').toBeDefined();
    expect(edgeX!.dstNodeId).toBe(helpX.id);

    // And repo-y's index imports repo-y's helper.
    const idxY = indexNodes.find((n) => n.repoFullName === 'collision/repo-y')!;
    const helpY = helperNodes.find((n) => n.repoFullName === 'collision/repo-y')!;
    const edgeY = allEdges.find((e) => e.srcNodeId === idxY.id);
    expect(edgeY, 'repo-y imports edge must exist').toBeDefined();
    expect(edgeY!.dstNodeId).toBe(helpY.id);
  });
});

// ---------------------------------------------------------------------------
// Monorepo dep-union: sub-package deps must be visible to detectors.
// The ROOT package.json has NO telemetry deps; only apps/x/package.json
// declares @opentelemetry/api. The merged-deps fix ensures detect-otel fires.
// ---------------------------------------------------------------------------
describe('runStructure — monorepo sub-package dep detection', () => {
  const MONO_TREES: Record<string, { path: string; content: string }[]> = {
    'mono/repo': [
      // Root package.json — no OTel dep.
      { path: 'package.json', content: JSON.stringify({ dependencies: { express: '^4' } }) },
      // Sub-package package.json — has @opentelemetry/api.
      { path: 'apps/x/package.json', content: JSON.stringify({ dependencies: { '@opentelemetry/api': '^1' } }) },
      { path: 'apps/x/src/index.ts', content: 'export const x = 1;' },
    ],
  };

  const monoClient = {
    getRefInfo: async () => ({ ref: 'main', sha: 'abcd1234' }),
    listTree: async (_c: unknown, repo: string) => ({
      truncated: false,
      entries: (MONO_TREES[repo] ?? []).map((f, i) => ({
        path: f.path, type: 'blob', sha: String(i), size: f.content.length,
      })),
    }),
    getFile: async (_c: unknown, repo: string, path: string) => {
      const f = (MONO_TREES[repo] ?? []).find((x) => x.path === path);
      return { text: f?.content ?? '', sha: 'x' };
    },
  } as any;

  let monoDb: Awaited<ReturnType<typeof startTestDb>>;
  let monoOrgId: string;
  let monoProjectId: string;
  const monoPublished: BuildJob[] = [];
  const monoPublisher: KgPublisher = { publish: async (job) => { monoPublished.push(job); } };

  beforeAll(async () => {
    monoDb = await startTestDb();
    const org = await createOrgWithOwner(monoDb.db, { name: 'Mono', slug: 'mono-org', userId: 'u-mono' });
    monoOrgId = org.id;

    const integId = await seedGithubIntegration(monoDb.db, monoOrgId, 'ghp_mono', 'u-mono');

    const project = await createProject(monoDb.db, monoOrgId, { name: 'MonoSys', slug: 'mono-sys' });
    monoProjectId = project.id;

    await addProjectRepo(monoDb.db, {
      projectId: monoProjectId, orgIntegrationId: integId, repoFullName: 'mono/repo',
      defaultBranch: 'main', addedByUserId: 'u-mono',
    });
  });
  afterAll(async () => { await monoDb.stop(); });

  it('detects OTel from a sub-package package.json when root package.json lacks the dep', async () => {
    const deps = {
      db: monoDb.db,
      store: monoDb.store,
      client: monoClient,
      config: { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
      kgPublisher: monoPublisher,
      skills: { skillsFor, listSkills },
    };

    await runPhase(deps, {
      orgId: monoOrgId, projectId: monoProjectId, repoFullName: '(project)',
      ref: '', mode: 'manual', phase: 'structure',
    });

    const build = await selectBuild(monoDb.db, { orgId: monoOrgId, projectId: monoProjectId });
    expect(build, 'build row must exist').toBeDefined();

    const nodes = await selectNodes(monoDb.db, build!.id);

    // detect-otel must produce a trace or metric signal node for the sub-package dep.
    const otelNode = nodes.find(
      (n) =>
        (n.kind === 'trace' || n.kind === 'metric') &&
        (n.metadata as Record<string, unknown>)?.['provider'] === 'otel',
    );
    expect(otelNode, 'OTel telemetry signal node from sub-package dep').toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Idempotency: redelivery with existing buildId must not duplicate nodes.
// ---------------------------------------------------------------------------
describe('runStructure — idempotency on redelivery', () => {
  let idemDb: Awaited<ReturnType<typeof startTestDb>>;
  let idemOrgId: string;
  let idemProjectId: string;
  let idemBuildId: string;
  const idemPublished: BuildJob[] = [];
  const idemPublisher: KgPublisher = { publish: async (job) => { idemPublished.push(job); } };

  const IDEM_TREES: Record<string, { path: string; content: string }[]> = {
    'idem/repo-a': [
      { path: 'src/foo.ts', content: "import './bar';" },
      { path: 'src/bar.ts', content: 'export const x = 1;' },
    ],
  };

  const idemClient = {
    getRefInfo: async () => ({ ref: 'main', sha: 'abcdef' }),
    listTree: async (_c: any, repo: string) => ({
      truncated: false,
      entries: (IDEM_TREES[repo] ?? []).map((f, i) => ({ path: f.path, type: 'blob', sha: String(i), size: f.content.length })),
    }),
    getFile: async (_c: any, repo: string, path: string) => {
      const f = (IDEM_TREES[repo] ?? []).find((x) => x.path === path);
      return { text: f?.content ?? '', sha: 'x' };
    },
  } as any;

  beforeAll(async () => {
    idemDb = await startTestDb();
    const org = await createOrgWithOwner(idemDb.db, { name: 'Idem', slug: 'idem-org', userId: 'u3' });
    idemOrgId = org.id;

    const integId = await seedGithubIntegration(idemDb.db, idemOrgId, 'ghp_z', 'u3');

    const project = await createProject(idemDb.db, idemOrgId, { name: 'IdemSys', slug: 'idem-sys' });
    idemProjectId = project.id;

    await addProjectRepo(idemDb.db, {
      projectId: idemProjectId, orgIntegrationId: integId, repoFullName: 'idem/repo-a',
      defaultBranch: 'main', addedByUserId: 'u3',
    });

    // Pre-create the build so both runs share the same buildId.
    const build = await createBuild(idemDb.db, {
      orgId: idemOrgId, repoFullName: '(project)', projectId: idemProjectId, mode: 'manual', phase: 'structure',
    });
    idemBuildId = build.id;
  });
  afterAll(async () => { await idemDb.stop(); });

  it('produces the same node count on a second run with the same buildId (no duplicates)', async () => {
    const deps = {
      db: idemDb.db,
      store: idemDb.store,
      client: idemClient,
      config: { SECRETS_KEY: Buffer.alloc(32, 1).toString('base64') },
      kgPublisher: idemPublisher,
      skills: { skillsFor, listSkills },
    };

    const job: BuildJob = {
      orgId: idemOrgId, projectId: idemProjectId, repoFullName: '(project)',
      ref: '', mode: 'manual', phase: 'structure', buildId: idemBuildId,
    };

    // First run.
    await runPhase(deps, job);
    const afterFirst = await selectNodes(idemDb.db, idemBuildId, 'file');
    const firstCount = afterFirst.length;
    expect(firstCount, 'at least one file node after first run').toBeGreaterThan(0);

    // Second run with the same buildId — idempotency guard must delete then re-insert.
    await runPhase(deps, job);
    const afterSecond = await selectNodes(idemDb.db, idemBuildId, 'file');
    expect(afterSecond.length, 'no duplicate file nodes after redelivery').toBe(firstCount);
  });
});
