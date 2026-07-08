import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createOrgWithOwner, createProject, addProjectMember, addProjectRepo,
  createBuild, finishBuild, insertNodes, insertEdges, setBuildPhase, setOrgKgEnabled,
  createTeamProposal, saveTeamProposalResult, getActiveTeamProposal, markTeamProposalApplied, listAssistants,
  upsertIntegration, getIntegration, setOrgDebugEnabled, createAssistant,
  upsertUser,
  RCA_OPERATING_PREAMBLE,
} from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { createSessionToken, SESSION_COOKIE } from '../src/auth/session.js';
import { startTestDb, testConfig } from './helpers.js';

const published: unknown[] = [];
const teamPublished: unknown[] = [];

// Unique counter to guarantee slug uniqueness across test runs (vitest may reuse the same DB)
let slugSeq = 0;
function nextSlug(prefix: string) { return `${prefix}${++slugSeq}`; }

// All org-scoped requests carry this header so resolveOrg can extract 'acme' from 'acme.beecause.ai'
// testConfig.BASE_URL is 'https://beecause.ai', domain = 'beecause.ai' → slug = 'acme'
const ACM_HOST = { 'x-forwarded-host': 'acme.beecause.ai' };
const OTHER_HOST = { 'x-forwarded-host': 'other.beecause.ai' };

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;

// Seeded identities
let orgId: string;
let projectId: string;

// u1 = owner, u2 = org member + project 'user', u3 = not a member at all
let cookieU1: Record<string, string>;
let cookieU2: Record<string, string>;
let cookieU3: Record<string, string>;

beforeAll(async () => {
  t = await startTestDb();
  app = await buildApp({
    db: t.db, store: t.store, config: testConfig,
    kgJobPublisher: { publish: async (j) => { published.push(j); } },
    teamAutogenPublisher: { publish: async (j) => { teamPublished.push(j); } },
    embed: async (texts) => texts.map(() => Array.from({ length: 768 }, () => 0.1)),
  });

  // Seed: org 'acme' with u1 as owner
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
  orgId = org.id;
  // Knowledge Graph is gated behind an org flag (off by default); enable it for
  // this org so the KG route tests exercise the real handlers.
  await setOrgKgEnabled(t.db, orgId, true);

  // Add u2 as an org member
  const u2MemberId = `${orgId}_u2`;
  await t.store.db.collection('org_members').doc(u2MemberId).set({ id: u2MemberId, orgId, userId: 'u2', role: 'user', createdAt: new Date() });

  // Create a project and add u2 as project 'user'
  const proj = await createProject(t.db, orgId, { name: 'Alpha', slug: 'alpha' });
  projectId = proj.id;
  await addProjectMember(t.db, orgId, projectId, 'u2', 'user');

  // Seed a users row so u2's email can be resolved
  await upsertUser(t.db, { userId: 'u2', email: 'u2@example.com' });

  // Session tokens
  cookieU1 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u1', email: 'u1@example.com' }, testConfig.SESSION_SECRET) };
  cookieU2 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u2', email: 'u2@example.com' }, testConfig.SESSION_SECRET) };
  cookieU3 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'u3', email: 'u3@example.com' }, testConfig.SESSION_SECRET) };
});

afterAll(async () => { await app.close(); await t.stop(); });

// The project seeded is 'alpha' — all project-scoped URLs use its slug.
const ALPHA = 'alpha';

// ─── GET /api/org ────────────────────────────────────────────────────────────

describe('GET /api/org', () => {
  it('returns org info + myOrgRole for the owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.slug).toBe('acme');
    expect(body.myOrgRole).toBe('owner');
  });

  it('returns 404 for a non-member', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU3, headers: ACM_HOST });
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a wrong/unknown org host', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: OTHER_HOST });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /api/org/projects ──────────────────────────────────────────────────

describe('POST /api/org/projects', () => {
  it('allows org admin (owner) to create a project → 201', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/projects', cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Beta', slug: 'beta' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().slug).toBe('beta');
  });

  it('rejects a regular member → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/org/projects', cookies: cookieU2, headers: ACM_HOST,
      payload: { name: 'Gamma', slug: 'gamma' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /api/org/projects ───────────────────────────────────────────────────

describe('GET /api/org/projects', () => {
  it('org admin sees ALL projects', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('alpha');
    expect(slugs).toContain('beta'); // created above
  });

  it('regular member sees only joined projects', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org/projects', cookies: cookieU2, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const slugs = res.json().map((p: { slug: string }) => p.slug);
    expect(slugs).toContain('alpha'); // u2 is a member
    expect(slugs).not.toContain('beta'); // u2 not in beta
  });
});

// ─── GET /api/org/projects/:slug ─────────────────────────────────────────────

describe('GET /api/org/projects/:slug', () => {
  it('project user (u2) gets myProjectRole=user', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}`, cookies: cookieU2, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().myProjectRole).toBe('user');
  });

  it('org admin (u1) gets myProjectRole=admin even without explicit project membership', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().myProjectRole).toBe('admin');
  });

  it('non-member gets 404', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}`, cookies: cookieU3, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /api/org/projects/:slug/assistants ─────────────────────────────────

describe('POST /api/org/projects/:slug/assistants', () => {
  it('project user (u2) cannot create assistant → 404', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU2, headers: ACM_HOST,
      payload: { name: 'Bot' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('org admin (u1) can create assistant → 201', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Helper', persona: 'Friendly SRE' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().name).toBe('Helper');
  });
});

// ─── POST /api/org/projects/:slug/members ────────────────────────────────────

describe('POST /api/org/projects/:slug/members', () => {
  it('returns 422 for an email that has never logged in', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/members`, cookies: cookieU1, headers: ACM_HOST,
      payload: { email: 'never@example.com', role: 'user' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('adds a known user by email, returns 200, and ensures org membership', async () => {
    // Seed u4 in the users table (they have logged in at least once)
    await upsertUser(t.db, { userId: 'u4', email: 'u4@example.com' });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/members`, cookies: cookieU1, headers: ACM_HOST,
      payload: { email: 'u4@example.com', role: 'user' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // Verify they appear in project members
    const membersRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/members`, cookies: cookieU1, headers: ACM_HOST,
    });
    const members = membersRes.json();
    expect(members.some((m: { userId: string }) => m.userId === 'u4')).toBe(true);

    // Verify they became an org member
    const orgMembersRes = await app.inject({
      method: 'GET', url: '/api/org/members', cookies: cookieU1, headers: ACM_HOST,
    });
    const orgMembers = orgMembersRes.json();
    expect(orgMembers.some((m: { userId: string }) => m.userId === 'u4')).toBe(true);
  });
});

// ─── PATCH /api/org/members/:userId ──────────────────────────────────────────

describe('PATCH /api/org/members/:userId', () => {
  it('returns 422 when trying to demote the last owner', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/org/members/u1`, cookies: cookieU1, headers: ACM_HOST,
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/last owner/);
  });
});

// ─── Wrong host → 404 ────────────────────────────────────────────────────────

describe('Wrong host', () => {
  it('returns 404 when org does not exist for the given host', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/org', cookies: cookieU1, headers: OTHER_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Assistants CRUD (project-scoped) ────────────────────────────────────────

describe('Assistants CRUD under project', () => {
  let assistantId: string;

  it('lists, updates, and deletes an assistant', async () => {
    // First create one (already done in prior describe, but let's create a fresh one here)
    const createRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'CRUD Bot' },
    });
    expect(createRes.statusCode).toBe(201);
    assistantId = createRes.json().id;

    // List
    const listRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(listRes.statusCode).toBe(200);
    const names = listRes.json().map((a: { name: string }) => a.name);
    expect(names).toContain('CRUD Bot');

    // Update
    const patchRes = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/assistants/${assistantId}`, cookies: cookieU1, headers: ACM_HOST,
      payload: { persona: 'Grumpy' },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json().persona).toBe('Grumpy');

    // Delete
    const delRes = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/assistants/${assistantId}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(delRes.statusCode).toBe(204);
  });

  it('returns 404 for a malformed assistant id', async () => {
    // GET list doesn't take an id — but PATCH/DELETE with bad id should 404
    const patchRes = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/assistants/not-a-uuid`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'X' },
    });
    expect(patchRes.statusCode).toBe(404);
    const delRes = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/assistants/not-a-uuid`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(delRes.statusCode).toBe(404);
  });

  it('project user can list assistants but not create/update/delete', async () => {
    // u2 is a project 'user'
    const listRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU2, headers: ACM_HOST,
    });
    expect(listRes.statusCode).toBe(200);

    const createRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU2, headers: ACM_HOST,
      payload: { name: 'Nope' },
    });
    expect(createRes.statusCode).toBe(404);
  });
});

// ─── FINDING 1: Non-existent slug should return 404 ─────────────────────────

describe('GET /api/org/projects/:slug — unknown slug', () => {
  it('returns 404 for a non-existent project slug', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/org/projects/does-not-exist', cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── FINDING 2: Admin role-escalation / owner-demotion guard ─────────────────

describe('PATCH /api/org/members/:userId — owner-touching role changes', () => {
  // Fresh org: f1=owner, f3=admin, f2=member  (independent of the acme seed above)
  let fOrgId: string;
  let fHost: Record<string, string>;
  let cookieF1: Record<string, string>;  // owner
  let cookieF3: Record<string, string>;  // admin

  beforeAll(async () => {
    const slug = nextSlug('finding2-');
    fHost = { 'x-forwarded-host': `${slug}.beecause.ai` };

    const fOrg = await createOrgWithOwner(t.db, { name: 'Finding2 Org', slug, userId: 'f1' });
    fOrgId = fOrg.id;

    const f2Id = `${fOrgId}_f2`;
    await t.store.db.collection('org_members').doc(f2Id).set({ id: f2Id, orgId: fOrgId, userId: 'f2', role: 'user', createdAt: new Date() });
    const f3Id = `${fOrgId}_f3`;
    await t.store.db.collection('org_members').doc(f3Id).set({ id: f3Id, orgId: fOrgId, userId: 'f3', role: 'manager', createdAt: new Date() });

    cookieF1 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'f1', email: 'f1@example.com' }, testConfig.SESSION_SECRET) };
    cookieF3 = { [SESSION_COOKIE]: await createSessionToken({ sub: 'f3', email: 'f3@example.com' }, testConfig.SESSION_SECRET) };
  });

  it('admin cannot self-promote to owner → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f3', cookies: cookieF3, headers: fHost,
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/owner/);
  });

  it('admin cannot demote an owner to member → 403', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f1', cookies: cookieF3, headers: fHost,
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/owner/);
  });

  it('admin CAN promote a member to admin → 200', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f2', cookies: cookieF3, headers: fHost,
      payload: { role: 'manager' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('owner CAN promote a member/admin to admin → 200', async () => {
    // f2 was promoted to admin above; promote back to member first then to admin
    // Actually just promote f3 (admin) to something safe — owner grants admin
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f2', cookies: cookieF1, headers: fHost,
      payload: { role: 'manager' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('owner CAN grant owner role to another user → 200', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f3', cookies: cookieF1, headers: fHost,
      payload: { role: 'owner' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it('owner demoting the last owner → 422 (unchanged last-owner guard)', async () => {
    // At this point f1 and f3 are both owners. Demote f3 back to member first.
    await app.inject({
      method: 'PATCH', url: '/api/org/members/f3', cookies: cookieF1, headers: fHost,
      payload: { role: 'user' },
    });
    // Now f1 is last owner — demoting self should 422
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/members/f1', cookies: cookieF1, headers: fHost,
      payload: { role: 'user' },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/last owner/);
  });
});

// ─── Approval policy (project write-operations policy) ───────────────────────

describe('approval policy', () => {
  it('defaults to no project policy and org-unmanaged', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/org/projects/${ALPHA}/approval-policy`, cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ policy: null, orgManaged: false });
  });

  it('admin can set a project policy and it reads back', async () => {
    const policy = { writeToolsRequireApproval: true, overrides: { 'integration.slack.post_message': false } };
    const put = await app.inject({ method: 'PUT', url: `/api/org/projects/${ALPHA}/approval-policy`, cookies: cookieU1, headers: ACM_HOST, payload: { policy } });
    expect(put.statusCode).toBe(204);
    const get = await app.inject({ method: 'GET', url: `/api/org/projects/${ALPHA}/approval-policy`, cookies: cookieU1, headers: ACM_HOST });
    expect(get.json().policy).toEqual(policy);
  });

  it('a project member (non-admin) cannot set the policy', async () => {
    const res = await app.inject({ method: 'PUT', url: `/api/org/projects/${ALPHA}/approval-policy`, cookies: cookieU2, headers: ACM_HOST, payload: { policy: null } });
    expect(res.statusCode).toBe(404); // projAdmin guard hides the route from non-admins
  });
});

// ─── Knowledge Graph endpoints ───────────────────────────────────────────────

describe('knowledge graph endpoints', () => {
  // D1: project-level build trigger
  it('POST build → creates a project build (projectId set, phase=structure) and publishes a job with buildId+phase', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/alpha/knowledge-graph/build`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.accepted).toBe(true);
    expect(typeof body.buildId).toBe('string');

    // Job published to the fake publisher must carry buildId + phase + projectId
    const job = published.at(-1) as Record<string, unknown>;
    expect(job).toMatchObject({
      orgId,
      projectId,
      repoFullName: '(project)',
      mode: 'manual',
      phase: 'structure',
      buildId: body.buildId,
    });
  });

  it('POST build → non-admin (u2) gets 404', async () => {
    const denied = await app.inject({
      method: 'POST', url: `/api/org/projects/alpha/knowledge-graph/build`,
      cookies: cookieU2, headers: ACM_HOST,
    });
    expect(denied.statusCode).toBe(404);
  });

  it('KG routes 404 when the org feature flag is off', async () => {
    await setOrgKgEnabled(t.db, orgId, false);
    const off = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/knowledge-graph`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(off.statusCode).toBe(404);
    await setOrgKgEnabled(t.db, orgId, true); // restore for the remaining KG tests
  });

  // D1: project-level status — running build shows phase
  it('GET knowledge-graph → returns build with phase + flows from the current done build', async () => {
    // Seed a project build in 'running' state with phase='flows'
    const runningBuild = await createBuild(t.db, { orgId, projectId, repoFullName: '(project)', mode: 'manual', phase: 'structure' });
    await setBuildPhase(t.db, runningBuild.id, 'flows');

    const statusRes = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/knowledge-graph`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(statusRes.statusCode).toBe(200);
    const statusBody = statusRes.json();
    // Running build should be visible (phase='flows')
    expect(statusBody.build).not.toBeNull();
    expect(statusBody.build.phase).toBe('flows');
    expect(statusBody.build.status).toBe('running');

    // Now finish the build and insert a flow node — flows should appear
    await finishBuild(t.db, runningBuild.id, { status: 'done', nodesAnalyzed: 1 });
    await insertNodes(t.db, [{
      buildId: runningBuild.id,
      orgId,
      repoFullName: '(project)',
      kind: 'flow',
      name: 'checkout-flow',
      businessFlow: 'Checkout',
      digest: 'Handles checkout.',
    }]);

    const doneRes = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/knowledge-graph`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(doneRes.statusCode).toBe(200);
    const doneBody = doneRes.json();
    expect(doneBody.build.status).toBe('done');
    expect(doneBody.flows).toHaveLength(1);
    expect(doneBody.flows[0].name).toBe('Checkout');
    expect(doneBody.flows[0].digest).toBe('Handles checkout.');
  });

  // D2: project graph
  it('GET knowledge-graph/graph returns nodes+edges for the current project build (no repo param needed)', async () => {
    // Seed a done project build with a component node, file node, and composes edge
    const build = await createBuild(t.db, { orgId, projectId, repoFullName: '(project)', mode: 'manual' });
    await finishBuild(t.db, build.id, { status: 'done', nodesAnalyzed: 2 });
    const [compNode, fileNode] = await insertNodes(t.db, [
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'component', name: 'AuthService', businessFlow: null, digest: null },
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'file', name: 'src/auth.ts', businessFlow: null, digest: null },
    ]);
    await insertEdges(t.db, [{ buildId: build.id, orgId, srcNodeId: compNode!.id, dstNodeId: fileNode!.id, relation: 'composes' }]);

    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/knowledge-graph/graph`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nodes.some((n: { kind: string }) => n.kind === 'component')).toBe(true);
    expect(body.nodes.some((n: { kind: string }) => n.kind === 'file')).toBe(true);
    expect(body.edges.length).toBeGreaterThan(0);
    expect(body.edges.some((e: { relation: string }) => e.relation === 'composes')).toBe(true);
  });

  // D2: children drill endpoint
  it('GET knowledge-graph/children?node=<id>&rel=composes returns child nodes', async () => {
    // Seed a done project build with component → 2 files via composes
    const build = await createBuild(t.db, { orgId, projectId, repoFullName: '(project)', mode: 'manual' });
    await finishBuild(t.db, build.id, { status: 'done', nodesAnalyzed: 3 });
    const [compNode, file1Node, file2Node] = await insertNodes(t.db, [
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'component', name: 'PaymentService', businessFlow: null, digest: null },
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'file', name: 'src/payment.ts', businessFlow: null, digest: null },
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'file', name: 'src/invoice.ts', businessFlow: null, digest: null },
    ]);
    await insertEdges(t.db, [
      { buildId: build.id, orgId, srcNodeId: compNode!.id, dstNodeId: file1Node!.id, relation: 'composes' },
      { buildId: build.id, orgId, srcNodeId: compNode!.id, dstNodeId: file2Node!.id, relation: 'composes' },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/org/projects/alpha/knowledge-graph/children?node=${compNode!.id}&rel=composes`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.children).toHaveLength(2);
    const names = body.children.map((n: { name: string }) => n.name).sort();
    expect(names).toEqual(['src/invoice.ts', 'src/payment.ts']);
  });

  it('GET knowledge-graph/children — node from a different project → 404', async () => {
    // Create a second project and a build in it
    const otherProj = await createProject(t.db, orgId, { name: 'Other KG Project', slug: nextSlug('other-kg-') });
    const otherBuild = await createBuild(t.db, { orgId, projectId: otherProj.id, repoFullName: '(project)', mode: 'manual' });
    await finishBuild(t.db, otherBuild.id, { status: 'done', nodesAnalyzed: 1 });
    const [otherNode] = await insertNodes(t.db, [{
      buildId: otherBuild.id, orgId, repoFullName: '(project)', kind: 'component', name: 'ForeignComp', businessFlow: null, digest: null,
    }]);

    // Request children of a node from otherProj via the 'alpha' project endpoint → 404
    const res = await app.inject({
      method: 'GET',
      url: `/api/org/projects/alpha/knowledge-graph/children?node=${otherNode!.id}&rel=composes`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET knowledge-graph/children — missing node query param → 400', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/alpha/knowledge-graph/children`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET knowledge-graph/children?dir=in&rel=touches returns parent (src) nodes (flow→component incoming)', async () => {
    // Seed: flow -[touches]-> component (builder direction)
    const build = await createBuild(t.db, { orgId, projectId, repoFullName: '(project)', mode: 'manual' });
    await finishBuild(t.db, build.id, { status: 'done', nodesAnalyzed: 2 });
    const [flowNode, compNode] = await insertNodes(t.db, [
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'flow', name: 'LoginFlow', businessFlow: null, digest: null },
      { buildId: build.id, orgId, repoFullName: '(project)', kind: 'component', name: 'AuthService', businessFlow: null, digest: null },
    ]);
    await insertEdges(t.db, [
      { buildId: build.id, orgId, srcNodeId: flowNode!.id, dstNodeId: compNode!.id, relation: 'touches' },
    ]);

    // dir=in on the component → returns the flow (the src node)
    const res = await app.inject({
      method: 'GET',
      url: `/api/org/projects/alpha/knowledge-graph/children?node=${compNode!.id}&rel=touches&dir=in`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.children).toHaveLength(1);
    expect(body.children[0].name).toBe('LoginFlow');
    expect(body.children[0].kind).toBe('flow');
  });
});

// ─── Team proposal routes ─────────────────────────────────────────────────────

const READY_PROPOSAL = {
  rationale: 'r',
  assistants: [
    { key: 'lead', name: 'Lead', persona: '', model: 'gemini-3.1-pro-preview', provider: 'platform' as const, tier: 'expensive' as const, isLead: true, isContactPoint: true, enabledTools: [], delegatesTo: ['spec'], rationale: '' },
    { key: 'spec', name: 'Spec', persona: '', model: 'gemini-3-flash-preview', provider: 'platform' as const, tier: 'cheap' as const, isLead: false, isContactPoint: false, enabledTools: [], delegatesTo: [], rationale: '' },
  ],
  gaps: [],
};

describe('team proposal routes', () => {
  // Each sub-test creates its own fresh project to control KG presence
  // deterministically and avoid cross-test interference.

  it('POST /team/generate with no code source → 422', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP NoSrc', slug: nextSlug('teamproj') });

    // Fresh project: no github integration seeded, no repos in scope
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/generate`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error).toMatch(/code source/);
  });

  it('POST /team/generate with code source → 202, status=generating, publishes team-autogen job', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Src', slug: nextSlug('teamproj') });
    const P = proj.id;

    // Seed a GitHub integration (enabled) and a project repo in scope
    await upsertIntegration(t.db, { orgId, provider: 'github', mode: 'pat', metadata: {} });
    const intg = await getIntegration(t.db, orgId, 'github');
    await addProjectRepo(t.db, { projectId: P, orgIntegrationId: intg!.id, repoFullName: 'acme/api', defaultBranch: 'main', addedByUserId: 'u1' });

    const teamPublishedBefore = teamPublished.length;

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/generate`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.status).toBe('generating');

    // A team-autogen job must have been published with the correct proposalId + projectId
    expect(teamPublished.length).toBe(teamPublishedBefore + 1);
    const job = teamPublished.at(-1) as Record<string, unknown>;
    expect(job).toMatchObject({ orgId, projectId: P, proposalId: body.id });
  });

  it('POST /team/generate is idempotent — returns the existing active proposal without creating a new one', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Idempotent', slug: nextSlug('teamproj') });
    const P = proj.id;

    // Seed an active proposal directly — idempotency check happens before the code-source precondition
    const existing = await createTeamProposal(t.db, { orgId, projectId: P, status: 'generating' });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/generate`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(existing.id); // same active proposal reused
  });

  it('POST /team/generate as plain member (u2) → 404 (projAdmin gate)', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP AuthZ', slug: nextSlug('teamproj') });
    await addProjectMember(t.db, orgId, proj.id, 'u2', 'user');

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/generate`,
      cookies: cookieU2, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404); // projAdmin hides the route from non-admins
  });

  it('POST /proposals/:pid/apply happy path → 201, creates assistants, proposal no longer active', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Apply Happy', slug: nextSlug('teamproj') });
    const P = proj.id;

    // Create a proposal and flip it to 'ready' via saveTeamProposalResult
    const proposal = await createTeamProposal(t.db, { orgId, projectId: P, status: 'generating' });
    await saveTeamProposalResult(t.db, proposal.id, { proposal: READY_PROPOSAL, buildId: null });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/proposals/${proposal.id}/apply`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);

    // DB should now have 2 assistants for this project
    const assistants = await listAssistants(t.db, P);
    expect(assistants).toHaveLength(2);

    // The proposal should no longer be "active" (status=applied, outside ACTIVE set)
    const active = await getActiveTeamProposal(t.db, P);
    expect(active).toBeNull();
  });

  it('activating a version sets it active and lists it via /team/versions', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Versions', slug: nextSlug('teamproj') });
    const proposal = await createTeamProposal(t.db, { orgId, projectId: proj.id, status: 'generating' });
    await saveTeamProposalResult(t.db, proposal.id, { proposal: READY_PROPOSAL, buildId: null });

    const applyRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/proposals/${proposal.id}/apply`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(applyRes.statusCode).toBe(201);

    const versRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/versions`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(versRes.statusCode).toBe(200);
    const v = versRes.json().versions.find((x: { id: string }) => x.id === proposal.id);
    expect(v.isActive).toBe(true);
  });

  it('editing an autogen agent flags user_modified', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Edited', slug: nextSlug('teamproj') });
    const proposal = await createTeamProposal(t.db, { orgId, projectId: proj.id, status: 'generating' });
    await saveTeamProposalResult(t.db, proposal.id, { proposal: READY_PROPOSAL, buildId: null });
    await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/proposals/${proposal.id}/apply`,
      cookies: cookieU1, headers: ACM_HOST,
    });

    const list = (await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/assistants`, cookies: cookieU1, headers: ACM_HOST,
    })).json();
    const agent = list[0];
    expect(agent.userModified).toBe(false);

    await app.inject({
      method: 'PATCH', url: `/api/org/projects/${proj.slug}/assistants/${agent.id}`,
      cookies: cookieU1, headers: ACM_HOST, payload: { persona: 'edited' },
    });

    const after = (await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/assistants`, cookies: cookieU1, headers: ACM_HOST,
    })).json();
    expect(after.find((a: { id: string }) => a.id === agent.id).userModified).toBe(true);
  });

  it('POST /proposals/:pid/apply 409 when proposal not ready', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Apply NotReady', slug: nextSlug('teamproj') });
    const P = proj.id;

    // Proposal in 'generating' status (no result saved yet)
    const proposal = await createTeamProposal(t.db, { orgId, projectId: P, status: 'generating' });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/proposals/${proposal.id}/apply`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(409);
  });

  it('POST /proposals/:pid/discard → 204, proposal no longer active', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP Discard', slug: nextSlug('teamproj') });
    const P = proj.id;

    const proposal = await createTeamProposal(t.db, { orgId, projectId: P, status: 'generating' });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/team/proposals/${proposal.id}/discard`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(204);

    // Should no longer be active
    const active = await getActiveTeamProposal(t.db, P);
    expect(active).toBeNull();
  });

  it('GET /team/proposal returns the active proposal, or null when none', async () => {
    // Project WITH an active proposal
    const proj1 = await createProject(t.db, orgId, { name: 'TP GetActive', slug: nextSlug('teamproj') });
    const proposal = await createTeamProposal(t.db, { orgId, projectId: proj1.id, status: 'generating' });

    const res1 = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj1.slug}/team/proposal`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().id).toBe(proposal.id);

    // Fresh project with NO proposal → should return null
    const proj2 = await createProject(t.db, orgId, { name: 'TP GetNone', slug: nextSlug('teamproj') });

    const res2 = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj2.slug}/team/proposal`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json()).toBeNull();
  });

  it('GET /team/proposal/latest returns the applied proposal (where /team/proposal returns null)', async () => {
    const proj = await createProject(t.db, orgId, { name: 'TP GetLatest', slug: nextSlug('teamproj') });
    const P = proj.id;

    const proposal = await createTeamProposal(t.db, { orgId, projectId: P, status: 'generating' });
    await saveTeamProposalResult(t.db, proposal.id, { proposal: READY_PROPOSAL, buildId: null });
    await markTeamProposalApplied(t.db, proposal.id);

    // The active endpoint no longer surfaces it…
    const active = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/proposal`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(active.statusCode).toBe(200);
    expect(active.json()).toBeNull();

    // …but the latest endpoint returns the applied proposal.
    const latest = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/proposal/latest`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(latest.statusCode).toBe(200);
    expect(latest.json().id).toBe(proposal.id);
    expect(latest.json().status).toBe('applied');

    // Fresh project with NO proposal → null
    const proj2 = await createProject(t.db, orgId, { name: 'TP GetLatestNone', slug: nextSlug('teamproj') });
    const none = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj2.slug}/team/proposal/latest`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(none.statusCode).toBe(200);
    expect(none.json()).toBeNull();
  });
});

// ─── GET /api/org — hindsightEnabled field ───────────────────────────────────

describe('GET /api/org — hindsightEnabled', () => {
  it('returns hindsightEnabled: false by default for the owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('hindsightEnabled', false);
  });
});

// ─── PATCH /api/org/settings ─────────────────────────────────────────────────

describe('PATCH /api/org/settings', () => {
  it('org admin (u1) can enable hindsight → 200 { ok: true }, then GET /api/org reflects the change', async () => {
    const patchRes = await app.inject({
      method: 'PATCH', url: '/api/org/settings', cookies: cookieU1, headers: ACM_HOST,
      payload: { hindsightEnabled: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toEqual({ ok: true });

    const getRes = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: ACM_HOST });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().hindsightEnabled).toBe(true);
  });

  it('plain org member (u2) cannot call PATCH /api/org/settings → 404 (requireOrgAdmin hides route from non-admins)', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/settings', cookies: cookieU2, headers: ACM_HOST,
      payload: { hindsightEnabled: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /api/org — showCostUsd field ────────────────────────────────────────

describe('GET /api/org — showCostUsd', () => {
  it('returns showCostUsd: false by default for the owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: ACM_HOST });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('showCostUsd', false);
  });
});

// ─── PATCH /api/org/settings — showCostUsd ───────────────────────────────────

describe('PATCH /api/org/settings — showCostUsd', () => {
  it('org admin (u1) can enable showCostUsd → 200 { ok: true }, then GET /api/org reflects the change', async () => {
    const patchRes = await app.inject({
      method: 'PATCH', url: '/api/org/settings', cookies: cookieU1, headers: ACM_HOST,
      payload: { showCostUsd: true },
    });
    expect(patchRes.statusCode).toBe(200);
    expect(patchRes.json()).toEqual({ ok: true });

    const getRes = await app.inject({ method: 'GET', url: '/api/org', cookies: cookieU1, headers: ACM_HOST });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json().showCostUsd).toBe(true);
  });

  it('plain org member (u2) cannot call PATCH /api/org/settings for showCostUsd → 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: '/api/org/settings', cookies: cookieU2, headers: ACM_HOST,
      payload: { showCostUsd: false },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── POST /assistants/preview-prompt (debug) ─────────────────────────────────

describe('POST /api/org/projects/:slug/assistants/preview-prompt', () => {
  it('404 when org debug flag is off', async () => {
    await setOrgDebugEnabled(t.db, orgId, false);
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/preview-prompt`, cookies: cookieU1, headers: ACM_HOST,
      payload: { persona: 'You are a debugger.', enabledTools: [] },
    });
    expect(res.statusCode).toBe(404);
  });

  it('assembles persona + RCA preamble + github skill block for a saved assistant when debug is on', async () => {
    await setOrgDebugEnabled(t.db, orgId, true);
    // Seed a github integration + repo in scope so the github skill renders.
    await upsertIntegration(t.db, { orgId, provider: 'github', mode: 'pat', metadata: {} });
    const intg = await getIntegration(t.db, orgId, 'github');
    await addProjectRepo(t.db, {
      projectId, orgIntegrationId: intg!.id,
      repoFullName: 'acme/api', defaultBranch: 'main', addedByUserId: 'u1',
    });
    const assistant = await createAssistant(t.db, projectId, {
      name: 'Investigator', persona: 'You are the lead investigator.',
      enabledTools: ['integration.github.get_file'], isLead: true,
    });

    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/preview-prompt`, cookies: cookieU1, headers: ACM_HOST,
      payload: { assistantId: assistant.id },
    });
    expect(res.statusCode).toBe(200);
    const { prompt } = res.json() as { prompt: string };
    expect(prompt).toContain('You are the lead investigator.'); // persona
    expect(prompt).toContain(RCA_OPERATING_PREAMBLE);             // RCA preamble
    expect(prompt).toContain('## GitHub tools');                  // integration skill block
    expect(prompt).toContain('acme/api');                         // repo in scope
  });

  it('assembles the prompt for a proposed (unsaved) assistant body', async () => {
    await setOrgDebugEnabled(t.db, orgId, true);
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/preview-prompt`, cookies: cookieU1, headers: ACM_HOST,
      payload: { persona: 'Proposed persona.', enabledTools: ['integration.github.get_file'], isLead: false },
    });
    expect(res.statusCode).toBe(200);
    const { prompt } = res.json() as { prompt: string };
    expect(prompt).toContain('Proposed persona.');
    expect(prompt).toContain(RCA_OPERATING_PREAMBLE);
    expect(prompt).toContain('## GitHub tools');
  });

  it('project members (u2) may preview; non-members (u3) 404', async () => {
    await setOrgDebugEnabled(t.db, orgId, true);
    const member = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/preview-prompt`, cookies: cookieU2, headers: ACM_HOST,
      payload: { persona: 'p', enabledTools: [] },
    });
    expect(member.statusCode).toBe(200);
    const nonMember = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/preview-prompt`, cookies: cookieU3, headers: ACM_HOST,
      payload: { persona: 'p', enabledTools: [] },
    });
    expect(nonMember.statusCode).toBe(404);
  });
});

// ─── Team memory CRUD (admin only) ───────────────────────────────────────────

describe('team memory CRUD', () => {
  it('POST /memories → 201 with content; GET includes it; DELETE → 204; GET no longer includes it', async () => {
    // POST
    const postRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/memories`, cookies: cookieU1, headers: ACM_HOST,
      payload: { content: 'db pool exhaustion → bump max' },
    });
    expect(postRes.statusCode).toBe(201);
    const mem = postRes.json();
    expect(mem.content).toBe('db pool exhaustion → bump max');
    expect(typeof mem.id).toBe('string');

    // GET — list includes the new memory
    const listRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(listRes.statusCode).toBe(200);
    const memories = listRes.json() as Array<{ id: string; content: string }>;
    expect(memories.some((m) => m.id === mem.id)).toBe(true);

    // DELETE
    const delRes = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/memories/${mem.id}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(delRes.statusCode).toBe(204);

    // GET — no longer in list
    const listRes2 = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(listRes2.statusCode).toBe(200);
    const memories2 = listRes2.json() as Array<{ id: string }>;
    expect(memories2.some((m) => m.id === mem.id)).toBe(false);
  });

  it('POST /memories as plain user (u2) → 404 (projAdmin gate)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/memories`, cookies: cookieU2, headers: ACM_HOST,
      payload: { content: 'plain user cannot add memory' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /memories/:mid with bad uuid → 404', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/memories/not-a-uuid`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /memories/:mid with unknown id → 404', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/memories/00000000-0000-0000-0000-000000000001`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Per-assistant private memory CRUD (admin only) ─────────────────────────

describe('per-assistant private memories', () => {
  let aid: string;

  beforeAll(async () => {
    // Create a FRESH assistant to get a clean isolated memory set for these tests
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Memory Test Assistant' },
    });
    expect(res.statusCode).toBe(201);
    aid = res.json().id;
  });

  it('POST /assistants/:aid/memories as admin → 201, scope === "private"', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
      payload: { content: 'remember the deploy step' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.scope).toBe('private');
    expect(body.content).toBe('remember the deploy step');
  });

  it('GET /assistants/:aid/memories as admin → 200, length === 1 (fresh assistant)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const memories = res.json() as Array<{ id: string; scope: string }>;
    expect(memories.length).toBe(1);
    expect(memories.every((m) => m.scope === 'private')).toBe(true);
  });

  it('DELETE lifecycle: POST a memory, DELETE it → 204, GET returns empty list', async () => {
    // POST a fresh memory
    const postRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
      payload: { content: 'lifecycle memory' },
    });
    expect(postRes.statusCode).toBe(201);
    const memId = postRes.json().id as string;

    // GET before delete — present (may have other memories from prior tests; just check this one is in there)
    const listBefore = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect((listBefore.json() as Array<{ id: string }>).some((m) => m.id === memId)).toBe(true);

    // DELETE → 204
    const delRes = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories/${memId}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(delRes.statusCode).toBe(204);

    // GET after delete — gone
    const listAfter = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect((listAfter.json() as Array<{ id: string }>).some((m) => m.id === memId)).toBe(false);
  });

  it('isolation: DELETE via a different assistant\'s URL → 404 (memory not deleted)', async () => {
    // Create assistant B
    const bRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Isolation Assistant B' },
    });
    expect(bRes.statusCode).toBe(201);
    const bId = bRes.json().id as string;

    // POST a memory under assistant A (aid)
    const postRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
      payload: { content: 'isolation test memory' },
    });
    expect(postRes.statusCode).toBe(201);
    const memId = postRes.json().id as string;

    // Attempt to DELETE A's memory via B's URL → 404 (isolation guard)
    const delRes = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/assistants/${bId}/memories/${memId}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(delRes.statusCode).toBe(404);

    // A's memory must still be intact
    const listRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect((listRes.json() as Array<{ id: string }>).some((m) => m.id === memId)).toBe(true);
  });

  it('DELETE /assistants/:aid/memories/:mid with unknown mid → 404', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories/00000000-0000-0000-0000-000000000002`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /assistants/:aid/memories as plain user (u2) → 404 (projAdmin gate)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants/${aid}/memories`, cookies: cookieU2, headers: ACM_HOST,
      payload: { content: 'plain user cannot add private memory' },
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET /api/org/projects/:slug/team/forecast ───────────────────────────────

describe('GET /team/forecast', () => {
  it('returns forecast with non-zero token counts when the project has assistants', async () => {
    // Create a fresh project with two assistants so we get a predictable non-zero forecast
    const proj = await createProject(t.db, orgId, { name: 'Forecast With Agents', slug: nextSlug('forecast-') });
    await addProjectMember(t.db, orgId, proj.id, 'u2', 'user');

    // Create two assistants: one specialist, one orchestrator (lead)
    await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Contact', model: 'gemini-3-flash-preview', isLead: false },
    });
    await app.inject({
      method: 'POST', url: `/api/org/projects/${proj.slug}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Lead', model: 'gemini-3.1-pro-preview', isLead: true },
    });

    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/forecast`,
      cookies: cookieU2, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('forecast');
    expect(body).toHaveProperty('showCostUsd');
    expect(typeof body.showCostUsd).toBe('boolean');
    const { forecast } = body;
    expect(forecast).toHaveProperty('basic');
    expect(forecast).toHaveProperty('medium');
    expect(forecast).toHaveProperty('large');
    expect(forecast.basic.inputTokens).toBeGreaterThan(0);
    expect(forecast.medium.inputTokens).toBeGreaterThan(0);
    expect(forecast.large.inputTokens).toBeGreaterThan(0);
  });

  it('returns forecast with zero tokens when the project has no assistants', async () => {
    const proj = await createProject(t.db, orgId, { name: 'Forecast Empty', slug: nextSlug('forecast-') });
    // u1 is org admin so has projMember access without explicit membership

    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/forecast`,
      cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.forecast.basic.inputTokens).toBe(0);
    expect(body.forecast.medium.inputTokens).toBe(0);
    expect(body.forecast.large.inputTokens).toBe(0);
  });

  it('non-member (u3) cannot access the forecast → 404', async () => {
    const proj = await createProject(t.db, orgId, { name: 'Forecast AuthZ', slug: nextSlug('forecast-') });

    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${proj.slug}/team/forecast`,
      cookies: cookieU3, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── Project skills + per-assistant attachment ────────────────────────────────

describe('project skills + attachment', () => {
  let sid: string;

  it('POST /skills as admin → 201; captures id', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'rollback', description: 'd', body: 'B' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(typeof body.id).toBe('string');
    sid = body.id;
  });

  it('POST same name again → 409 (unique violation)', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'rollback', description: 'd', body: 'B' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('GET /skills as admin → 200, list contains the created skill', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string }>;
    expect(list.some((s) => s.id === sid)).toBe(true);
  });

  it('PATCH /skills/:sid → 200, body updated to B2', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/skills/${sid}`, cookies: cookieU1, headers: ACM_HOST,
      payload: { body: 'B2' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().body).toBe('B2');
  });

  it('DELETE /skills/:sid → 204', async () => {
    const res = await app.inject({
      method: 'DELETE', url: `/api/org/projects/${ALPHA}/skills/${sid}`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(204);
  });

  it('attachment: create skill + assistant; PUT skills → 204; GET skills returns that id', async () => {
    // Create a fresh skill
    const skillRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'attach-skill', description: 'for attachment', body: 'body' },
    });
    expect(skillRes.statusCode).toBe(201);
    const attachSid = skillRes.json().id as string;

    // Create an assistant (local — no cross-test shared state needed)
    const assistantRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Skill Test Assistant' },
    });
    expect(assistantRes.statusCode).toBe(201);
    const aidForSkills = assistantRes.json().id as string;

    // PUT attach
    const putRes = await app.inject({
      method: 'PUT', url: `/api/org/projects/${ALPHA}/assistants/${aidForSkills}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { skillIds: [attachSid] },
    });
    expect(putRes.statusCode).toBe(204);

    // GET attached skills
    const getRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aidForSkills}/skills`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(getRes.statusCode).toBe(200);
    const attached = getRes.json() as Array<{ id: string }>;
    expect(attached.some((s) => s.id === attachSid)).toBe(true);
  });

  it('detach: PUT skills with empty array → 204; GET returns empty list', async () => {
    // Create a fresh skill and assistant for this test
    const skillRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'detach-skill', description: 'for detach', body: 'body' },
    });
    expect(skillRes.statusCode).toBe(201);
    const detachSid = skillRes.json().id as string;

    const assistantRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/assistants`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'Detach Test Assistant' },
    });
    expect(assistantRes.statusCode).toBe(201);
    const aidForDetach = assistantRes.json().id as string;

    // Attach the skill first
    const attachRes = await app.inject({
      method: 'PUT', url: `/api/org/projects/${ALPHA}/assistants/${aidForDetach}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { skillIds: [detachSid] },
    });
    expect(attachRes.statusCode).toBe(204);

    // Detach by replacing with empty list
    const detachRes = await app.inject({
      method: 'PUT', url: `/api/org/projects/${ALPHA}/assistants/${aidForDetach}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { skillIds: [] },
    });
    expect(detachRes.statusCode).toBe(204);

    // GET → empty array
    const getRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/assistants/${aidForDetach}/skills`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(getRes.statusCode).toBe(200);
    expect(getRes.json()).toEqual([]);
  });

  it('PATCH rename to existing name → 409 (unique violation)', async () => {
    // Create two skills with distinct names
    const alphaRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'alpha-skill', description: 'd', body: 'B' },
    });
    expect(alphaRes.statusCode).toBe(201);

    const betaRes = await app.inject({
      method: 'POST', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'beta-skill', description: 'd', body: 'B' },
    });
    expect(betaRes.statusCode).toBe(201);
    const betaSid = betaRes.json().id as string;

    // Attempt to rename beta-skill to alpha-skill → should 409
    const patchRes = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/skills/${betaSid}`, cookies: cookieU1, headers: ACM_HOST,
      payload: { name: 'alpha-skill' },
    });
    expect(patchRes.statusCode).toBe(409);
  });

  it('non-admin (u2) hitting GET /skills → 404 (projAdmin gate)', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/skills`, cookies: cookieU2, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

// ─── GET + PATCH /api/org/projects/:slug/settings ────────────────────────────

describe('GET /api/org/projects/:slug/settings', () => {
  it('returns issuesEnabled and issuesOrgEnabled flags', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.issuesEnabled).toBe('boolean');
    expect(typeof body.issuesOrgEnabled).toBe('boolean');
  });

  it('issuesOrgEnabled is true when the github integration has issuesEnabled=true', async () => {
    await upsertIntegration(t.db, {
      orgId, provider: 'github', mode: 'pat', accountLabel: 'acme',
      secretCiphertext: null, secretHint: null, baseUrl: null,
      metadata: { issuesEnabled: true, events: { issues: true, pullRequests: true, branches: true } },
      connectedByUserId: 'u1', lastTestOk: true,
    });
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().issuesOrgEnabled).toBe(true);
  });

  it('non-admin (u2) → 404', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU2, headers: ACM_HOST,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('PATCH /api/org/projects/:slug/settings', () => {
  it('project admin sets issuesEnabled → 200 and flag is persisted', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU1, headers: ACM_HOST,
      payload: { issuesEnabled: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
    // verify it reads back
    const getRes = await app.inject({
      method: 'GET', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU1, headers: ACM_HOST,
    });
    expect(getRes.json().issuesEnabled).toBe(true);
  });

  it('non-admin (u2) → 404', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/org/projects/${ALPHA}/settings`, cookies: cookieU2, headers: ACM_HOST,
      payload: { issuesEnabled: false },
    });
    expect(res.statusCode).toBe(404);
  });
});
