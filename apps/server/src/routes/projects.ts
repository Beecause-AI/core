import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createProject, getProject, getProjectBySlug, updateProject, deleteProject, listProjectsForOrg, listManageableProjects, projectScopeCounts,
  listProjectMembers, addProjectMember, setProjectRole, removeProjectMember, userIdByEmail,
  listAssistants, createAssistant, getAssistant, updateAssistant, deleteAssistant, forecastTeamCost,
  listOrgMembers, setOrgRole, getMembership, getProjectRole,
  listProjectRepos, addProjectRepo, removeProjectRepo,
  resolveRepoRef,
  searchCatalog, getCatalogRepo, getSyncState, startSync, isCatalogStale, getIntegration,
  searchGitlabCatalog, getGitlabCatalogRepo, getGitlabSyncState, startGitlabSync, isGitlabCatalogStale,
  getBinding, setBinding, deleteBinding, listBindingsForProject, listAvailableBindings,
  getTeamsBinding, setTeamsBinding, deleteTeamsBinding, listTeamsBindingsForProject, listAvailableTeamsBindings,
  getOrgApprovalPolicy, getProjectApprovalPolicy, setProjectApprovalPolicy, type ApprovalPolicy,
  createBuild,
  getLatestProjectBuild, buildBelongsToProject,
  getProjectGraph, getProjectFlows,
  getNode, getChildren, getParents,
  createTeamProposal, getActiveTeamProposal, getLatestTeamProposal, getTeamProposal,
  setTeamProposalStatus, markTeamProposalApplied, applyTeamProposal,
  listTeamVersions, setProjectActiveProposal,
  addTeamMemory, listMemories, deleteMemory, addPrivateMemory, listPrivateMemories, deletePrivateMemory,
  createSkill, listSkills, updateSkill, deleteSkill, listAttachedSkills, setAttachedSkills,
  setOrgHindsightEnabled, setOrgShowCostUsd, setOrgReportsEnabled,
  setProjectIssuesEnabled, setProjectReportsEnabled,
  listSystemAgents,
  type KgJobPublisher, type TeamAutogenPublisher,
} from '@intellilabs/core';
import { keyFromBase64, decryptSecret, realSlackClient, type SlackClient } from '@intellilabs/core';
import { resolveOrg } from '../auth/org-context.js';
import {
  requireUser, requireOrgMember, requireOrgAdmin, requireProjectMember, requireProjectAdmin, isOrgAdminRole,
} from '../auth/guard.js';
import { realGithubClient, type GithubClient } from '../integrations/github/client.js';
import { advanceCatalogSync } from '../integrations/github/catalog-sync.js';
import { realGitlabClient } from '../integrations/gitlab/client.js';
import { advanceCatalogSync as advanceGitlabCatalogSync } from '../integrations/gitlab/catalog-sync.js';
import { appendIntegrationSkills, withSkillTool } from '../integrations/skill.js';

const Uuid = z.string().min(1);
const id = (s: string) => (Uuid.safeParse(s).success ? s : null);
const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,38}$/);
const CreateProject = z.object({ name: z.string().min(1).max(100), slug: Slug, description: z.string().max(2000).optional() });
const UpdateProject = z.object({ name: z.string().min(1).max(100).optional(), description: z.string().max(2000).optional(), slug: Slug.optional() });
const AssistantBody = z.object({
  name: z.string().min(1).max(100), persona: z.string().max(200000).optional(),
  model: z.string().min(1).optional(),
  provider: z.enum(['platform', 'anthropic', 'openai', 'google', 'openai-compatible']).nullish(),
  enabledTools: z.array(z.string()).optional(),
  isLead: z.boolean().optional(),
});
const AddMember = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(['admin', 'user']).default('user') });
const AddRepo = z.object({ repoFullName: z.string().regex(/^[^/]+\/[^/]+$/) });
const SkillBody = z.object({ name: z.string().min(1).max(80), description: z.string().max(2000).default(''), body: z.string().max(100000).default('') });
const AttachBody = z.object({ skillIds: z.array(Uuid).max(100) });

function unique(e: unknown): boolean {
  const c = (e ?? {}) as { code?: string; cause?: { code?: string } };
  return c.code === '23505' || c.cause?.code === '23505';
}

export async function projectRoutes(app: FastifyInstance, opts: { githubClient?: GithubClient; kgJobPublisher?: KgJobPublisher; slackClient?: SlackClient; teamAutogenPublisher?: TeamAutogenPublisher; embed?: (texts: string[]) => Promise<number[][]> } = {}) {
  const client = opts.githubClient ?? realGithubClient;
  const slackClient = opts.slackClient ?? realSlackClient;
  const kgJobPublisher: KgJobPublisher = opts.kgJobPublisher ?? { publish: async () => {} };
  const teamAutogenPublisher: TeamAutogenPublisher = opts.teamAutogenPublisher ?? { publish: async () => {} };
  const embed = opts.embed;
  const org = { preHandler: [resolveOrg, requireUser, requireOrgMember] };
  const orgAdmin = { preHandler: [resolveOrg, requireUser, requireOrgAdmin] };
  const projMember = { preHandler: [resolveOrg, requireUser, requireProjectMember] };
  const projAdmin = { preHandler: [resolveOrg, requireUser, requireProjectAdmin] };
  // Knowledge Graph is an org-scoped feature flag (off by default, toggled in the
  // super console). When disabled, its routes 404 — hiding the feature entirely.
  const requireKgEnabled = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.org?.kgEnabled) return reply.code(404).send({ error: 'not found' });
  };
  const projMemberKg = { preHandler: [resolveOrg, requireUser, requireProjectMember, requireKgEnabled] };
  const projAdminKg = { preHandler: [resolveOrg, requireUser, requireProjectAdmin, requireKgEnabled] };

  const secretsKey = () => keyFromBase64(app.config.SECRETS_KEY!);
  const catalogSyncDeps = () => ({ db: app.db, client, secretsKey: secretsKey(), appId: app.config.GITHUB_APP_ID, appPrivateKey: app.config.GITHUB_APP_PRIVATE_KEY });
  const gitlabCatalogSyncDeps = () => ({ db: app.db, client: realGitlabClient, secretsKey: keyFromBase64(app.config.SECRETS_KEY!) });

  app.get('/api/org', org, async (req) => ({ slug: req.org!.slug, name: req.org!.name, myOrgRole: req.orgRole, kgEnabled: req.org!.kgEnabled, hindsightEnabled: req.org!.hindsightEnabled, showCostUsd: req.org!.showCostUsd, reportsEnabled: req.org!.reportsEnabled, debugEnabled: req.org!.debugEnabled, billingEnabled: req.org!.billingEnabled, billingBand: req.org!.billingBand }));

  app.patch('/api/org/settings', orgAdmin, async (req) => {
    const body = z.object({ hindsightEnabled: z.boolean().optional(), showCostUsd: z.boolean().optional(), reportsEnabled: z.boolean().optional() }).parse(req.body);
    if (body.hindsightEnabled !== undefined) await setOrgHindsightEnabled(app.db, req.org!.id, body.hindsightEnabled);
    if (body.showCostUsd !== undefined) await setOrgShowCostUsd(app.db, req.org!.id, body.showCostUsd);
    if (body.reportsEnabled !== undefined) await setOrgReportsEnabled(app.db, req.org!.id, body.reportsEnabled);
    return { ok: true };
  });

  app.get('/api/org/projects', org, async (req) =>
    listProjectsForOrg(app.db, req.org!.id, req.user!.sub, isOrgAdminRole(req.orgRole)));

  app.post('/api/org/projects', orgAdmin, async (req, reply) => {
    const body = CreateProject.parse(req.body);
    try {
      return reply.code(201).send(await createProject(app.db, req.org!.id, body));
    } catch (e) { if (unique(e)) return reply.code(409).send({ error: 'slug already taken' }); throw e; }
  });

  // Resolve a project id to its slug (used by the legacy /project redirect page).
  app.get<{ Params: { projectId: string } }>('/api/org/projects/by-id/:projectId', org, async (req, reply) => {
    const pid = id(req.params.projectId); if (!pid) return reply.code(404).send({ error: 'not found' });
    const p = await getProject(app.db, req.org!.id, pid);
    if (!p) return reply.code(404).send({ error: 'not found' });
    if (!isOrgAdminRole(req.orgRole)) {
      const role = await getProjectRole(app.db, p.id, req.user!.sub);
      if (!role) return reply.code(404).send({ error: 'not found' });
    }
    return { slug: p.slug };
  });

  app.get('/api/org/members', orgAdmin, async (req) => listOrgMembers(app.db, req.org!.id));
  app.patch<{ Params: { userId: string } }>('/api/org/members/:userId', orgAdmin, async (req, reply) => {
    const role = z.enum(['owner', 'manager', 'user']).parse((req.body as { role: string }).role);
    const targetId = req.params.userId;
    const target = await getMembership(app.db, req.org!.id, targetId);
    if (!target) return reply.code(404).send({ error: 'not found' });
    const ownerTouching = role === 'owner' || target.role === 'owner';
    if (ownerTouching && req.orgRole !== 'owner') return reply.code(403).send({ error: 'only an owner can change owner roles' });
    const ok = await setOrgRole(app.db, req.org!.id, targetId, role);
    if (!ok) return reply.code(422).send({ error: 'cannot demote the last owner' });
    return { ok: true };
  });

  // ── Project GitHub issue settings (by slug) ───────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/settings', projAdmin, async (req, reply) => {
    const gh = await getIntegration(app.db, req.org!.id, 'github');
    const meta = (gh?.metadata as Record<string, unknown> | null) ?? {};
    // Back-compat shim: a missing issuesEnabled coalesces to the legacy copilot flag.
    const orgIssues = !!gh?.enabled && !!((meta.issuesEnabled as boolean | undefined) ?? (meta.copilotEnabled as boolean | undefined));
    // GitLab has its own org-level master switch; the project-level flag below is shared.
    const gl = await getIntegration(app.db, req.org!.id, 'gitlab');
    const glMeta = (gl?.metadata as Record<string, unknown> | null) ?? {};
    const orgIssuesGitlab = !!gl?.enabled && !!(glMeta.issuesEnabled as boolean | undefined);
    const proj = req.project!;
    const projIssues = (proj.issuesEnabled as boolean | undefined) ?? !!proj.copilotEnabled;
    return {
      issuesEnabled: !!projIssues, issuesOrgEnabled: orgIssues, issuesOrgEnabledGitlab: orgIssuesGitlab,
    };
  });

  app.patch<{ Params: { slug: string } }>('/api/org/projects/:slug/settings', projAdmin, async (req, reply) => {
    const body = z.object({ issuesEnabled: z.boolean().optional(), reportsEnabled: z.boolean().optional() }).parse(req.body);
    if (body.issuesEnabled !== undefined) {
      const updated = await setProjectIssuesEnabled(app.db, req.org!.id, req.project!.id, body.issuesEnabled);
      if (!updated) return reply.code(404).send({ error: 'not found' });
    }
    if (body.reportsEnabled !== undefined) {
      const updated = await setProjectReportsEnabled(app.db, req.org!.id, req.project!.id, body.reportsEnabled);
      if (!updated) return reply.code(404).send({ error: 'not found' });
    }
    return { ok: true };
  });

  // ── Project detail / update / delete (by slug) ────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug', projMember, async (req) => {
    const counts = await projectScopeCounts(app.db, req.project!.id);
    return { ...req.project, myProjectRole: req.projectRole, counts };
  });
  app.patch<{ Params: { slug: string } }>('/api/org/projects/:slug', projAdmin, async (req, reply) => {
    const patch = UpdateProject.parse(req.body);
    try {
      const p = await updateProject(app.db, req.org!.id, req.project!.id, patch);
      return p ?? reply.code(404).send({ error: 'not found' });
    } catch (e) { if (unique(e)) return reply.code(409).send({ error: 'slug already taken' }); throw e; }
  });
  app.delete<{ Params: { slug: string } }>('/api/org/projects/:slug', projAdmin, async (req, reply) => {
    await deleteProject(app.db, req.org!.id, req.project!.id);
    return reply.code(204).send();
  });

  // ── Members (by slug) ─────────────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/members', projMember, async (req) =>
    listProjectMembers(app.db, req.project!.id));
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/members', projAdmin, async (req, reply) => {
    const { email, role } = AddMember.parse(req.body);
    const uid = await userIdByEmail(app.db, email);
    if (!uid) return reply.code(422).send({ error: 'user must sign in once before being added' });
    await addProjectMember(app.db, req.org!.id, req.project!.id, uid, role);
    return { ok: true };
  });
  app.patch<{ Params: { slug: string; userId: string } }>('/api/org/projects/:slug/members/:userId', projAdmin, async (req) => {
    await setProjectRole(app.db, req.project!.id, req.params.userId, z.enum(['admin', 'user']).parse((req.body as { role: string }).role));
    return { ok: true };
  });
  app.delete<{ Params: { slug: string; userId: string } }>('/api/org/projects/:slug/members/:userId', projAdmin, async (req, reply) => {
    await removeProjectMember(app.db, req.project!.id, req.params.userId);
    return reply.code(204).send();
  });

  // ── Assistants (by slug) ──────────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/assistants', projMember, async (req) =>
    listAssistants(app.db, req.project!.id));
  // System-agent metadata for the team-structure view (predefined personas like Slack Intake / Hindsight).
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/system-agents', projMember, async () =>
    listSystemAgents().map((s) => ({ key: s.key, name: s.name })));
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/assistants', projAdmin, async (req, reply) =>
    reply.code(201).send(await createAssistant(app.db, req.project!.id, AssistantBody.parse(req.body))));
  app.patch<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const existing = await getAssistant(app.db, req.project!.id, aid);
    if (!existing) return reply.code(404).send({ error: 'not found' });
    const patch = AssistantBody.partial().parse(req.body);
    // Editing an autogen-created agent marks it user-modified (powers the "edited" badge).
    const a = await updateAssistant(app.db, req.project!.id, aid, existing.sourceProposalId ? { ...patch, userModified: true } : patch);
    return a ?? reply.code(404).send({ error: 'not found' });
  });
  app.delete<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const ok = await deleteAssistant(app.db, req.project!.id, aid);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });
  // ── Debug: assembled system-prompt preview ────────────────────────────────
  // Returns the fully-assembled system prompt an investigator agent would receive
  // (persona + RCA preamble + integration skill blocks), reusing the runtime
  // assembly. Gated behind the org debug flag → 404 when off, hiding the feature.
  const PreviewPromptBody = z.union([
    z.object({ assistantId: Uuid }),
    z.object({ persona: z.string().max(200000), enabledTools: z.array(z.string()).default([]), isLead: z.boolean().optional() }),
  ]);
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/assistants/preview-prompt', projMember, async (req, reply) => {
    if (!req.org!.debugEnabled) return reply.code(404).send({ error: 'not found' });
    const body = PreviewPromptBody.parse(req.body);
    let persona = '';
    let enabledTools: string[] = [];
    let assistantId: string | undefined;
    if ('assistantId' in body) {
      const a = await getAssistant(app.db, req.project!.id, body.assistantId);
      if (!a) return reply.code(404).send({ error: 'not found' });
      persona = a.persona ?? '';
      enabledTools = await withSkillTool(app.db, a.id, (a.enabledTools as string[] | null) ?? []);
      assistantId = a.id;
    } else {
      persona = body.persona;
      enabledTools = body.enabledTools;
    }
    const messages = await appendIntegrationSkills(
      app.db, req.project!.id, enabledTools,
      [{ role: 'system', content: persona }],
      { preamble: true, assistantId },
    );
    const prompt = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n---\n\n');
    return { prompt };
  });

  // ── AI-designed team (proposals) ──────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/team/proposal', projMember, async (req) =>
    (await getActiveTeamProposal(app.db, req.project!.id)) ?? null);

  // The most recent NON-discarded proposal (incl. applied) — powers the generation-results page,
  // which must keep showing the last generation after the team has been applied.
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/team/proposal/latest', projMember, async (req) =>
    (await getLatestTeamProposal(app.db, req.project!.id)) ?? null);

  // Team design uses the knowledge graph internally but does NOT reveal it, so it is NOT
  // gated behind the org kgEnabled flag (projAdmin, not projAdminKg).
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/team/generate', projAdmin, async (req, reply) => {
    const orgId = req.org!.id, projectId = req.project!.id;
    const existing = await getActiveTeamProposal(app.db, projectId);
    if (existing) return reply.code(202).send(existing); // idempotent: reuse the active proposal
    // Precondition: a connected code source (GitHub) + at least one repo in scope.
    const gh = await getIntegration(app.db, orgId, 'github');
    const repos = await listProjectRepos(app.db, projectId);
    if (!gh || !gh.enabled || repos.length === 0) return reply.code(422).send({ error: 'connect a code source first' });
    const proposal = await createTeamProposal(app.db, { orgId, projectId, status: 'generating' });
    await teamAutogenPublisher.publish({ orgId, projectId, proposalId: proposal.id });
    return reply.code(202).send(proposal);
  });

  app.post<{ Params: { slug: string; pid: string } }>('/api/org/projects/:slug/team/proposals/:pid/apply', projAdmin, async (req, reply) => {
    const pid = id(req.params.pid); if (!pid) return reply.code(404).send({ error: 'not found' });
    const proposal = await getTeamProposal(app.db, pid);
    if (!proposal || proposal.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    // "Apply" doubles as "activate this version" — ready (fresh) OR applied (re-activation) is fine.
    if (!proposal.proposal || (proposal.status !== 'ready' && proposal.status !== 'applied')) {
      return reply.code(409).send({ error: 'version not ready' });
    }
    const created = await applyTeamProposal(app.db, req.project!.id, proposal.proposal, pid);
    await markTeamProposalApplied(app.db, pid);
    await setProjectActiveProposal(app.db, req.project!.id, pid);
    return reply.code(201).send(created);
  });

  app.post<{ Params: { slug: string; pid: string } }>('/api/org/projects/:slug/team/proposals/:pid/discard', projAdmin, async (req, reply) => {
    const pid = id(req.params.pid); if (!pid) return reply.code(404).send({ error: 'not found' });
    const proposal = await getTeamProposal(app.db, pid);
    if (!proposal || proposal.projectId !== req.project!.id) return reply.code(404).send({ error: 'not found' });
    await setTeamProposalStatus(app.db, pid, 'discarded');
    return reply.code(204).send();
  });

  // The 10 most recent usable team versions (ready|applied) for the version switcher.
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/team/versions', projMember, async (req) =>
    listTeamVersions(app.db, req.project!.id));

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/team/forecast', projMember, async (req) => {
    const assistants = await listAssistants(app.db, req.project!.id);
    const forecast = forecastTeamCost(assistants.map((a) => ({
      model: a.model, isLead: a.isLead,
    })));
    return { forecast, showCostUsd: req.org!.showCostUsd };
  });

  // ── Repos in scope (by slug) ──────────────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/repos', projMember, async (req) => {
    const gh = await getIntegration(app.db, req.org!.id, 'github');
    const repos = await listProjectRepos(app.db, req.project!.id);
    return gh ? repos.filter((r) => r.orgIntegrationId === gh.id) : [];
  });
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/repos', projAdmin, async (req, reply) => {
    const { repoFullName } = AddRepo.parse(req.body);
    const intg = await getIntegration(app.db, req.org!.id, 'github');
    if (!intg) return reply.code(422).send({ error: 'connect GitHub first' });
    const cat = await getCatalogRepo(app.db, intg.id, repoFullName);
    try {
      const row = await addProjectRepo(app.db, {
        projectId: req.project!.id, orgIntegrationId: intg.id, repoFullName,
        defaultBranch: cat?.defaultBranch ?? null, addedByUserId: req.user!.sub,
      });
      return reply.code(201).send(row);
    } catch (e) { if (unique(e)) return reply.code(409).send({ error: 'repo already in scope' }); throw e; }
  });
  app.delete<{ Params: { slug: string; repoId: string } }>('/api/org/projects/:slug/repos/:repoId', projAdmin, async (req, reply) => {
    const rid = id(req.params.repoId); if (!rid) return reply.code(404).send({ error: 'not found' });
    const ok = await removeProjectRepo(app.db, req.project!.id, rid);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // ── GitLab repos in scope (by slug) ──────────────────────────────────────
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/gitlab-repos', projMember, async (req) => {
    const gl = await getIntegration(app.db, req.org!.id, 'gitlab');
    const repos = await listProjectRepos(app.db, req.project!.id);
    return gl ? repos.filter((r) => r.orgIntegrationId === gl.id) : [];
  });
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/gitlab-repos', projAdmin, async (req, reply) => {
    const { repoFullName } = AddRepo.parse(req.body);
    const intg = await getIntegration(app.db, req.org!.id, 'gitlab');
    if (!intg) return reply.code(422).send({ error: 'connect GitLab first' });
    const cat = await getGitlabCatalogRepo(app.db, intg.id, repoFullName);
    try {
      const row = await addProjectRepo(app.db, {
        projectId: req.project!.id, orgIntegrationId: intg.id, repoFullName,
        defaultBranch: cat?.defaultBranch ?? null, addedByUserId: req.user!.sub,
      });
      return reply.code(201).send(row);
    } catch (e) { if (unique(e)) return reply.code(409).send({ error: 'repo already in scope' }); throw e; }
  });
  app.delete<{ Params: { slug: string; repoId: string } }>('/api/org/projects/:slug/gitlab-repos/:repoId', projAdmin, async (req, reply) => {
    const rid = id(req.params.repoId); if (!rid) return reply.code(404).send({ error: 'not found' });
    const ok = await removeProjectRepo(app.db, req.project!.id, rid);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // ── Approval policy (project write-operations policy; org policy takes precedence) ──
  const PolicyBody = z.object({
    policy: z.object({
      writeToolsRequireApproval: z.boolean(),
      overrides: z.record(z.string(), z.boolean()).optional(),
    }).nullable(),
  });
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/approval-policy', projMember, async (req) => {
    const policy = await getProjectApprovalPolicy(app.db, req.project!.id);
    // When the org has its own policy it replaces the project's wholesale (see resolveApprovalRequired).
    const orgManaged = (await getOrgApprovalPolicy(app.db, req.org!.id)) !== null;
    return { policy, orgManaged };
  });
  app.put<{ Params: { slug: string } }>('/api/org/projects/:slug/approval-policy', projAdmin, async (req, reply) => {
    const { policy } = PolicyBody.parse(req.body);
    await setProjectApprovalPolicy(app.db, req.project!.id, policy as ApprovalPolicy | null);
    return reply.code(204).send();
  });

  // ── GitHub repo catalog (org-level; powers the Add-repositories page) ──────
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>(
    '/api/org/integrations/github/catalog', org, async (req, reply) => {
      const intg = await getIntegration(app.db, req.org!.id, 'github');
      if (!intg) return reply.code(422).send({ error: 'connect GitHub first' });
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100) : 50;
      const result = await searchCatalog(app.db, intg.id, { q: req.query.q, cursor: req.query.cursor ?? null, limit });
      const sync = await getSyncState(app.db, intg.id);
      return {
        repos: result.rows,
        nextCursor: result.nextCursor,
        total: result.total,
        sync: { status: sync.status, repoCount: sync.repoCount, finishedAt: sync.finishedAt, error: sync.error, stale: isCatalogStale(sync) },
      };
    });

  // Advance the sync one GitHub page. The page polls this while status==='syncing'.
  app.post('/api/org/integrations/github/catalog/sync', org, async (req, reply) => {
    const intg = await getIntegration(app.db, req.org!.id, 'github');
    if (!intg) return reply.code(422).send({ error: 'connect GitHub first' });
    return advanceCatalogSync(intg, catalogSyncDeps());
  });

  // Force a fresh full pass (admin); subsequent /sync calls re-paginate from page 1.
  app.post('/api/org/integrations/github/catalog/refresh', orgAdmin, async (req, reply) => {
    const intg = await getIntegration(app.db, req.org!.id, 'github');
    if (!intg) return reply.code(422).send({ error: 'connect GitHub first' });
    await startSync(app.db, intg.id);
    return advanceCatalogSync(intg, catalogSyncDeps());
  });

  // ── GitLab repo catalog (org-level; powers the Add-repositories page) ──────
  app.get<{ Querystring: { q?: string; cursor?: string; limit?: string } }>(
    '/api/org/integrations/gitlab/catalog', org, async (req, reply) => {
      const intg = await getIntegration(app.db, req.org!.id, 'gitlab');
      if (!intg) return reply.code(422).send({ error: 'connect GitLab first' });
      const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100) : 50;
      const result = await searchGitlabCatalog(app.db, intg.id, { q: req.query.q, cursor: req.query.cursor ?? null, limit });
      const sync = await getGitlabSyncState(app.db, intg.id);
      return {
        repos: result.rows,
        nextCursor: result.nextCursor,
        total: result.total,
        sync: { status: sync.status, repoCount: sync.repoCount, finishedAt: sync.finishedAt, error: sync.error, stale: isGitlabCatalogStale(sync) },
      };
    });

  // Advance the sync one GitLab page. The page polls this while status==='syncing'.
  app.post('/api/org/integrations/gitlab/catalog/sync', org, async (req, reply) => {
    const intg = await getIntegration(app.db, req.org!.id, 'gitlab');
    if (!intg) return reply.code(422).send({ error: 'connect GitLab first' });
    return advanceGitlabCatalogSync(intg, gitlabCatalogSyncDeps());
  });

  // Force a fresh full pass (admin); subsequent /sync calls re-paginate from page 1.
  app.post('/api/org/integrations/gitlab/catalog/refresh', orgAdmin, async (req, reply) => {
    const intg = await getIntegration(app.db, req.org!.id, 'gitlab');
    if (!intg) return reply.code(422).send({ error: 'connect GitLab first' });
    await startGitlabSync(app.db, intg.id);
    return advanceGitlabCatalogSync(intg, gitlabCatalogSyncDeps());
  });

  // ── Project-scoped Slack channel bindings ─────────────────────────────────
  // A channel is org-wide (belongs to the org's slack integration) but binds to
  // exactly one project. A project admin may claim free channels (projectId null)
  // and manage their own project's channels. Only a true org admin (owner/manager)
  // may reassign a channel that is already bound to a different project.

  const SlackClaim = z.object({ channelId: z.string().min(1), threadTs: z.string().min(1).optional() });

  // Returns true when the write should be blocked (caller is not an org admin and
  // the channel is already bound to a different project).
  function slackWriteBlocked(
    existing: { projectId: string | null } | null,
    projectId: string,
    orgRole: string | null | undefined,
  ): boolean {
    return !!existing?.projectId && existing.projectId !== projectId && !isOrgAdminRole(orgRole);
  }

  // Landing context for the Slack "connect this channel" deep link. The signed-in
  // user's org is resolved from the workspace host; we verify it owns the Slack
  // team the link was generated for, then list the projects they may administer.
  app.get<{ Querystring: { team?: string; channel?: string } }>('/api/org/slack-connect-context', org, async (req, reply) => {
    const channelId = req.query.channel ?? '';
    const conn = await getIntegration(app.db, req.org!.id, 'slack');
    if (!conn) return { connected: false, orgName: req.org!.name, orgSlug: req.org!.slug, channelId, currentBinding: null, projects: [] };
    const teamId = (conn.metadata as { teamId?: string } | null)?.teamId;
    if (req.query.team && teamId && req.query.team !== teamId) {
      return reply.code(403).send({ error: 'this link is for a different workspace' });
    }
    const [manageable, binding] = await Promise.all([
      listManageableProjects(app.db, req.org!.id, req.user!.sub, isOrgAdminRole(req.orgRole)),
      channelId ? getBinding(app.db, conn.id, channelId) : Promise.resolve(null),
    ]);
    return {
      connected: true,
      orgName: req.org!.name,
      orgSlug: req.org!.slug,
      channelId,
      currentBinding: binding ? { status: binding.status, projectId: binding.projectId } : null,
      projects: manageable.map((p) => ({ id: p.id, name: p.name, slug: p.slug })),
    };
  });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/slack-channels', projMember, async (req) => {
    const conn = await getIntegration(app.db, req.org!.id, 'slack');
    if (!conn) return { connected: false, assigned: [], available: [] };
    const [assigned, available] = await Promise.all([
      listBindingsForProject(app.db, conn.id, req.project!.id),
      listAvailableBindings(app.db, conn.id),
    ]);
    return { connected: true, assigned, available };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/slack-channels', projAdmin, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, 'slack');
    if (!conn) return reply.code(409).send({ error: 'slack not connected' });
    const parsed = SlackClaim.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getBinding(app.db, conn.id, parsed.data.channelId);
    if (slackWriteBlocked(existing, req.project!.id, req.orgRole)) return reply.code(409).send({ error: 'channel is assigned to another project' });
    const row = await setBinding(app.db, {
      orgIntegrationId: conn.id, slackChannelId: parsed.data.channelId,
      projectId: req.project!.id, createdByUserId: req.user!.sub,
    });
    // When the bind came from the in-Slack "Connect this channel" flow, confirm
    // back in the originating thread so the user knows it's live and how to use it.
    if (parsed.data.threadTs && conn.secretCiphertext) {
      try {
        const botToken = decryptSecret(conn.secretCiphertext, keyFromBase64(app.config.SECRETS_KEY!));
        await slackClient.chatPostMessage(botToken, {
          channel: parsed.data.channelId,
          threadTs: parsed.data.threadTs,
          text: `✅ This channel is now connected to *${req.project!.name}*. Mention me in a message here and I'll help.`,
        });
      } catch (err) {
        app.log.error({ err }, 'slack connect confirmation post failed');
      }
    }
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { slug: string; channelId: string } }>('/api/org/projects/:slug/slack-channels/:channelId', projAdmin, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, 'slack');
    if (!conn) return reply.code(204).send();
    const existing = await getBinding(app.db, conn.id, req.params.channelId);
    if (!existing) return reply.code(204).send();
    if (slackWriteBlocked(existing, req.project!.id, req.orgRole)) return reply.code(409).send({ error: 'channel is assigned to another project' });
    await deleteBinding(app.db, conn.id, req.params.channelId);
    return reply.code(204).send();
  });

  // ── Teams channel bindings ────────────────────────────────────────────────────
  // Mirrors the slack-channels block above; provider = 'teams', binding key = conversationId.

  const TeamsClaim = z.object({ conversationId: z.string().min(1) });

  function teamsWriteBlocked(
    existing: { projectId: string | null } | null,
    projectId: string,
    orgRole: string | null | undefined,
  ): boolean {
    return !!existing?.projectId && existing.projectId !== projectId && !isOrgAdminRole(orgRole);
  }

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/teams-channels', projMember, async (req) => {
    const conn = await getIntegration(app.db, req.org!.id, 'teams');
    if (!conn) return { connected: false, assigned: [], available: [] };
    const [assigned, available] = await Promise.all([
      listTeamsBindingsForProject(app.db, conn.id, req.project!.id),
      listAvailableTeamsBindings(app.db, conn.id),
    ]);
    return { connected: true, assigned, available };
  });

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/teams-channels', projAdmin, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, 'teams');
    if (!conn) return reply.code(409).send({ error: 'teams not connected' });
    const parsed = TeamsClaim.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid input' });
    const existing = await getTeamsBinding(app.db, conn.id, parsed.data.conversationId);
    if (teamsWriteBlocked(existing, req.project!.id, req.orgRole)) return reply.code(409).send({ error: 'channel is assigned to another project' });
    const row = await setTeamsBinding(app.db, {
      orgIntegrationId: conn.id, teamsConversationId: parsed.data.conversationId,
      projectId: req.project!.id, createdByUserId: req.user!.sub,
    });
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { slug: string; conversationId: string } }>('/api/org/projects/:slug/teams-channels/:conversationId', projAdmin, async (req, reply) => {
    const conn = await getIntegration(app.db, req.org!.id, 'teams');
    if (!conn) return reply.code(204).send();
    const existing = await getTeamsBinding(app.db, conn.id, req.params.conversationId);
    if (!existing) return reply.code(204).send();
    if (teamsWriteBlocked(existing, req.project!.id, req.orgRole)) return reply.code(409).send({ error: 'channel is assigned to another project' });
    await deleteTeamsBinding(app.db, conn.id, req.params.conversationId);
    return reply.code(204).send();
  });

  // ── Knowledge Graph ───────────────────────────────────────────────────────────

  /** Trigger a project-level knowledge-graph build (project admin only). */
  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/knowledge-graph/build', projAdminKg, async (req, reply) => {
    const orgId = req.org!.id;
    const projectId = req.project!.id;
    const build = await createBuild(app.db, { orgId, projectId, repoFullName: '(project)', mode: 'manual', phase: 'structure' });
    await kgJobPublisher.publish({
      orgId,
      projectId,
      repoFullName: '(project)',
      mode: 'manual',
      buildId: build.id,
      phase: 'structure',
    });
    return reply.code(202).send({ accepted: true, buildId: build.id });
  });

  /** Return the project-level knowledge-graph status + flows (project member). */
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/knowledge-graph', projMemberKg, async (req) => {
    const orgId = req.org!.id;
    const projectId = req.project!.id;
    const latestBuild = await getLatestProjectBuild(app.db, orgId, projectId);
    const flows = await getProjectFlows(app.db, orgId, projectId);
    return {
      build: latestBuild
        ? {
            status: latestBuild.status,
            phase: latestBuild.phase ?? null,
            nodesAnalyzed: latestBuild.nodesAnalyzed,
            tokens: latestBuild.tokens,
            note: latestBuild.note ?? null,
            finishedAt: latestBuild.finishedAt ?? null,
          }
        : null,
      flows: flows.map((f) => ({
        id: f.id,
        name: f.businessFlow ?? f.name,
        digest: f.digest ?? null,
      })),
    };
  });

  /** Return the current project build's full graph ({nodes,edges}) (project member). */
  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/knowledge-graph/graph', projMemberKg, async (req) => {
    return getProjectGraph(app.db, req.org!.id, req.project!.id);
  });

  /** Return children of a node reachable via the given edge relations (project member). */
  app.get<{ Params: { slug: string }; Querystring: { node?: string; rel?: string; dir?: string } }>(
    '/api/org/projects/:slug/knowledge-graph/children', projMemberKg, async (req, reply) => {
      const nodeId = req.query.node;
      if (!nodeId) return reply.code(400).send({ error: 'node query param required' });
      const node = await getNode(app.db, nodeId);
      if (!node) return reply.code(404).send({ error: 'node not found' });
      // Scope check: node must belong to the requesting org and a build for this project
      if (node.orgId !== req.org!.id) return reply.code(404).send({ error: 'node not found' });
      const inProject = await buildBelongsToProject(app.db, node.buildId, req.project!.id);
      if (!inProject) return reply.code(404).send({ error: 'node not found' });
      const relations = (req.query.rel ?? '').split(',').filter(Boolean);
      const dir = req.query.dir === 'in' ? 'in' : 'out';
      const children = dir === 'in'
        ? await getParents(app.db, nodeId, relations)
        : await getChildren(app.db, nodeId, relations);
      return { children };
    },
  );

  // ── Team memories (admin CRUD) ───────────────────────────────────────────────

  const MemoryBody = z.object({ content: z.string().min(1).max(8000) });

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/memories', projAdmin, async (req) =>
    listMemories(app.db, { projectId: req.project!.id, scope: 'team' }));

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/memories', projAdmin, async (req, reply) => {
    if (!embed) return reply.code(503).send({ error: 'embeddings not configured' });
    const { content } = MemoryBody.parse(req.body);
    const [vec] = await embed([content]);
    if (!vec) return reply.code(503).send({ error: 'embedding failed' });
    const row = await addTeamMemory(app.store, { orgId: req.org!.id, projectId: req.project!.id, content, embedding: vec });
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { slug: string; mid: string } }>('/api/org/projects/:slug/memories/:mid', projAdmin, async (req, reply) => {
    const mid = id(req.params.mid); if (!mid) return reply.code(404).send({ error: 'not found' });
    const ok = await deleteMemory(app.store, req.project!.id, mid);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // ── Private (per-assistant) memories (admin CRUD) ────────────────────────────

  app.get<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid/memories', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const a = await getAssistant(app.db, req.project!.id, aid);
    if (!a) return reply.code(404).send({ error: 'not found' });
    return listPrivateMemories(app.db, { projectId: req.project!.id, assistantId: aid });
  });

  app.post<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid/memories', projAdmin, async (req, reply) => {
    if (!embed) return reply.code(503).send({ error: 'embeddings not configured' });
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const a = await getAssistant(app.db, req.project!.id, aid);
    if (!a) return reply.code(404).send({ error: 'not found' });
    const { content } = MemoryBody.parse(req.body);
    const [vec] = await embed([content]);
    if (!vec) return reply.code(503).send({ error: 'embedding failed' });
    const row = await addPrivateMemory(app.store, { orgId: req.org!.id, projectId: req.project!.id, assistantId: aid, content, embedding: vec });
    return reply.code(201).send(row);
  });

  app.delete<{ Params: { slug: string; aid: string; mid: string } }>('/api/org/projects/:slug/assistants/:aid/memories/:mid', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); const mid = id(req.params.mid);
    if (!aid || !mid) return reply.code(404).send({ error: 'not found' });
    const ok = await deletePrivateMemory(app.store, { projectId: req.project!.id, assistantId: aid, id: mid });
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // ── Skills library (project-level, admin CRUD) ───────────────────────────────

  app.get<{ Params: { slug: string } }>('/api/org/projects/:slug/skills', projAdmin, async (req) =>
    listSkills(app.db, req.project!.id));

  app.post<{ Params: { slug: string } }>('/api/org/projects/:slug/skills', projAdmin, async (req, reply) => {
    const b = SkillBody.parse(req.body);
    try {
      const row = await createSkill(app.db, { orgId: req.org!.id, projectId: req.project!.id, ...b });
      return reply.code(201).send(row);
    } catch (e) {
      if (unique(e)) return reply.code(409).send({ error: 'a skill with that name already exists' });
      throw e;
    }
  });

  app.patch<{ Params: { slug: string; sid: string } }>('/api/org/projects/:slug/skills/:sid', projAdmin, async (req, reply) => {
    const sid = id(req.params.sid); if (!sid) return reply.code(404).send({ error: 'not found' });
    const patch = SkillBody.partial().parse(req.body);
    try {
      const row = await updateSkill(app.db, req.project!.id, sid, patch);
      return row ?? reply.code(404).send({ error: 'not found' });
    } catch (e) {
      if (unique(e)) return reply.code(409).send({ error: 'a skill with that name already exists' });
      throw e;
    }
  });

  app.delete<{ Params: { slug: string; sid: string } }>('/api/org/projects/:slug/skills/:sid', projAdmin, async (req, reply) => {
    const sid = id(req.params.sid); if (!sid) return reply.code(404).send({ error: 'not found' });
    const ok = await deleteSkill(app.db, req.project!.id, sid);
    return ok ? reply.code(204).send() : reply.code(404).send({ error: 'not found' });
  });

  // ── Skill attachment (per assistant) ─────────────────────────────────────────

  app.get<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid/skills', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const a = await getAssistant(app.db, req.project!.id, aid);
    if (!a) return reply.code(404).send({ error: 'not found' });
    return listAttachedSkills(app.db, aid);
  });

  app.put<{ Params: { slug: string; aid: string } }>('/api/org/projects/:slug/assistants/:aid/skills', projAdmin, async (req, reply) => {
    const aid = id(req.params.aid); if (!aid) return reply.code(404).send({ error: 'not found' });
    const a = await getAssistant(app.db, req.project!.id, aid);
    if (!a) return reply.code(404).send({ error: 'not found' });
    const { skillIds } = AttachBody.parse(req.body);
    // Defense: only attach skills that belong to this project.
    const owned = new Set((await listSkills(app.db, req.project!.id)).map((s) => s.id));
    await setAttachedSkills(app.db, aid, skillIds.filter((s) => owned.has(s)));
    return reply.code(204).send();
  });
}
