import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createOrgWithOwner, createProject, upsertIntegration, getIntegration, addProjectRepo, encryptSecret, createBuild, finishBuild, insertNodes, addGcpConnection, setGcpProjectConnection, addSentryConnection, setSentryProjectConnection, addGrafanaConnection, setGrafanaProjectConnection, setIntegrationIssuesEnabled, setProjectIssuesEnabled, setOrgReportsEnabled, setProjectReportsEnabled } from '@intellilabs/core';
import { buildApp } from '../src/app.js';
import { knowledgeGraphToolDefs } from '../src/integrations/knowledge-graph/tools.js';
import { startTestDb, testConfig } from './helpers.js';

const SECRETS_KEY = Buffer.alloc(32, 1).toString('base64');

const githubClient = {
  probePat: async () => ({ ok: true, accountLabel: 'acme' }),
  probeApp: async () => ({ ok: true }),
  installationAccount: async () => null,
  listRepos: async () => [],
  listReposDetailed: async () => ({ repos: [], nextPage: null }),
  getFile: async () => ({ text: 'hi', sha: 's' }),
  listDirectory: async () => [],
  getRefInfo: async () => ({ ref: 'main', sha: 'abc' }),
  searchCode: async () => [],
  searchIssues: async () => [],
  getIssue: async () => ({ number: 1, title: 't', state: 'open', body: '' }),
  createIssue: async () => ({ number: 1, url: 'u' }),
  listPullRequests: async () => [],
  getPullRequest: async () => ({ number: 1, title: 't', state: 'open', body: '', diff: '' }),
} as any;

let t: Awaited<ReturnType<typeof startTestDb>>;
let app: FastifyInstance;
let appDeny: FastifyInstance;
let orgId: string;
let projectId: string;

beforeAll(async () => {
  t = await startTestDb();

  // Seed org + project + github integration + project repo
  const org = await createOrgWithOwner(t.db, { name: 'Acme', slug: 'acme', userId: 'u1' });
  orgId = org.id;

  const proj = await createProject(t.db, orgId, { name: 'Web', slug: 'web' });
  projectId = proj.id;

  const secretsKey = Buffer.alloc(32, 1);
  const secretCiphertext = encryptSecret('ghp_dummy', secretsKey);
  await upsertIntegration(t.db, {
    orgId,
    provider: 'github',
    mode: 'pat',
    secretCiphertext,
    connectedByUserId: 'u1',
    metadata: {},
  });
  const intg = await getIntegration(t.db, orgId, 'github');

  await addProjectRepo(t.db, {
    projectId: proj.id,
    orgIntegrationId: intg!.id,
    repoFullName: 'acme/web',
    defaultBranch: 'main',
    addedByUserId: 'u1',
  });

  app = await buildApp({
    db: t.db, store: t.store,
    config: { ...testConfig, SECRETS_KEY },
    githubClient,
    verifyServiceAuth: async () => true,
  });

  appDeny = await buildApp({
    db: t.db, store: t.store,
    config: { ...testConfig, SECRETS_KEY },
    githubClient,
    verifyServiceAuth: async () => false,
  });
});

afterAll(async () => {
  await app.close();
  await appDeny.close();
  await t.stop();
});

describe('/int/tools', () => {
  afterEach(async () => {
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', false);
    await setProjectIssuesEnabled(t.db, orgId, projectId, false);
  });

  it('lists tool defs', async () => {
    const res = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId } });
    expect(res.statusCode).toBe(200);
    expect(res.json().tools.some((t: any) => t.name === 'integration.github.get_file')).toBe(true);
  });

  it('calls a tool with scope + ref injection', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/call',
      payload: { orgId, projectId, name: 'integration.github.get_file', args: { repo: 'acme/web', path: 'README.md' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('hi');
  });

  it('rejects when service auth fails', async () => {
    const res = await appDeny.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId } });
    expect(res.statusCode).toBe(401);
  });

  it('lists all 4 knowledge-graph tool names', async () => {
    const res = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId } });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    const kgNames = knowledgeGraphToolDefs().map((d) => d.name);
    for (const n of kgNames) expect(names).toContain(n);
  });

  it('gates gcp tool defs by the bound connection\'s available signals', async () => {
    // Fresh project bound to a gcp connection that only grants the logging signal.
    const gcpProj = await createProject(t.db, orgId, { name: 'GcpOnly', slug: 'gcp-only' });
    const conn = await addGcpConnection(t.db, {
      orgId,
      name: 'prod',
      mode: 'sa_key',
      secretCiphertext: encryptSecret('{}', Buffer.alloc(32, 1)),
      metadata: { availableSignals: ['logging'] },
      createdByUserId: 'u1',
    });
    await setGcpProjectConnection(t.db, { orgId, projectId: gcpProj!.id, connectionId: conn.id, userId: 'u1' });

    const res = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId: gcpProj!.id } });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).toContain('integration.gcp.query_logs');
    // signal-less tools are always offered when a connection is bound
    expect(names).toContain('integration.gcp.list_scope');
    expect(names).not.toContain('integration.gcp.query_metrics');
  });

  it('offers sentry tools only when a connection is bound, and dispatches list_scope', async () => {
    const sentryProj = await createProject(t.db, orgId, { name: 'SentryOnly', slug: 'sentry-only' });
    // Unbound: no sentry tools.
    const none = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId: sentryProj!.id } });
    expect((none.json().tools as { name: string }[]).some((x) => x.name.startsWith('integration.sentry.'))).toBe(false);

    // Bind a connection → tools appear.
    const conn = await addSentryConnection(t.db, {
      orgId, name: 'prod', mode: 'auth_token', baseUrl: 'https://sentry.io',
      secretCiphertext: encryptSecret('tok', Buffer.alloc(32, 1)),
      metadata: { sentryOrgSlug: 'acme' }, createdByUserId: 'u1',
    });
    await setSentryProjectConnection(t.db, { orgId, projectId: sentryProj!.id, connectionId: conn.id, userId: 'u1' });

    const list = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId: sentryProj!.id } });
    const names: string[] = list.json().tools.map((x: { name: string }) => x.name);
    expect(names).toContain('integration.sentry.list_scope');
    expect(names).toContain('integration.sentry.get_latest_event');

    // Dispatch list_scope (no network: reads the binding + targets) → unrestricted scope.
    const call = await app.inject({
      method: 'POST', url: '/int/tools/call',
      payload: { orgId, projectId: sentryProj!.id, name: 'integration.sentry.list_scope', args: {} },
    });
    expect(call.statusCode).toBe(200);
    expect(JSON.parse(call.json().content)).toEqual({ org: 'acme', unrestricted: true, projects: [] });
  });

  it('gates grafana tools by the bound connection signals and dispatches list_scope', async () => {
    const gProj = await createProject(t.db, orgId, { name: 'GrafanaOnly', slug: 'grafana-only' });
    const conn = await addGrafanaConnection(t.db, {
      orgId, name: 'g', mode: 'grafana', baseUrl: 'https://g.io',
      secretCiphertext: encryptSecret('tok', Buffer.alloc(32, 1)),
      metadata: { availableSignals: ['metrics'], datasources: [{ uid: 'p1', name: 'Prom', type: 'prometheus' }] },
      createdByUserId: 'u1',
    });
    await setGrafanaProjectConnection(t.db, { orgId, projectId: gProj!.id, connectionId: conn.id, userId: 'u1' });

    const list = await app.inject({ method: 'POST', url: '/int/tools/list', payload: { orgId, projectId: gProj!.id } });
    const names: string[] = list.json().tools.map((x: { name: string }) => x.name);
    expect(names).toContain('integration.grafana.list_scope');
    expect(names).toContain('integration.grafana.query_metrics');
    expect(names).not.toContain('integration.grafana.query_logs');

    const call = await app.inject({
      method: 'POST', url: '/int/tools/call',
      payload: { orgId, projectId: gProj!.id, name: 'integration.grafana.list_scope', args: {} },
    });
    expect(call.statusCode).toBe(200);
    expect(JSON.parse(call.json().content)).toEqual({ unrestricted: true, datasources: [{ uid: 'p1', type: 'prometheus', name: 'Prom' }] });
  });

  it('offer_github_issue included when slackThread context + gate ON', async () => {
    // Seed: turn on copilotEnabled on the github integration + the project
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', true);
    await setProjectIssuesEnabled(t.db, orgId, projectId, true);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId, context: { slackThread: { channel: 'C123', threadTs: '1234567890.000001' } } },
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).toContain('integration.github.offer_github_issue');
  });

  it('offer_github_issue excluded when slackThread context + gate OFF (project flag false)', async () => {
    // integration copilotEnabled=true but project copilotEnabled=false → gate OFF
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', true);
    // project copilotEnabled stays false (default)

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId, context: { slackThread: { channel: 'C123', threadTs: '1234567890.000001' } } },
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('integration.github.offer_github_issue');
  });

  it('offer_github_issue excluded when no slackThread context even if gate ON', async () => {
    // Turn gate fully ON
    await setIntegrationIssuesEnabled(t.db, orgId, 'github', true);
    await setProjectIssuesEnabled(t.db, orgId, projectId, true);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId }, // no context
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('integration.github.offer_github_issue');
  });

  it('offer_investigation_report included when slackThread context + report gate ON', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, true);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId, context: { slackThread: { channel: 'C123', threadTs: '1234567890.000001' } } },
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).toContain('integration.report.offer_investigation_report');
  });

  it('offer_investigation_report excluded when slackThread context + report gate OFF (project flag false)', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, false);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId, context: { slackThread: { channel: 'C123', threadTs: '1234567890.000001' } } },
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('integration.report.offer_investigation_report');
  });

  it('offer_investigation_report excluded when no slackThread context even if report gate ON', async () => {
    await setOrgReportsEnabled(t.db, orgId, true);
    await setProjectReportsEnabled(t.db, orgId, projectId, true);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/list',
      payload: { orgId, projectId }, // no context
    });
    expect(res.statusCode).toBe(200);
    const names: string[] = res.json().tools.map((t: { name: string }) => t.name);
    expect(names).not.toContain('integration.report.offer_investigation_report');
  });

  it('routes integration.knowledge-graph.list_flows to the KG tool', async () => {
    // Seed a project-scoped done build with a flow node so getCurrentProjectBuildId resolves
    const build = await createBuild(t.db, { orgId, projectId, repoFullName: 'acme/web', mode: 'manual' });
    await finishBuild(t.db, build.id, { status: 'done', nodesAnalyzed: 1 });
    const [flowNode] = await insertNodes(t.db, [{
      buildId: build.id,
      orgId,
      repoFullName: 'acme/web',
      kind: 'flow',
      name: 'checkout-flow',
      businessFlow: 'Checkout',
      digest: 'Buys things.',
    }]);

    const res = await app.inject({
      method: 'POST',
      url: '/int/tools/call',
      payload: { orgId, projectId, name: 'integration.knowledge-graph.list_flows', args: {} },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.isError).toBeFalsy();
    // list_flows returns { id, name, digest, repo } where name = businessFlow ?? name
    const flows = JSON.parse(body.content) as Array<{ id: string; name: string; digest: string; repo: string | null }>;
    expect(flows.some((f) => f.id === flowNode!.id && f.name === 'Checkout')).toBe(true);
  });
});
