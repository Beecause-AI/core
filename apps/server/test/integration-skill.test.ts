import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createOrgWithOwner, createProject, upsertIntegration, getIntegration, addProjectRepo, createAssistant, createSkill, setAttachedSkills } from '@intellilabs/core';
import type { Db } from '@intellilabs/core';
import { renderGithubSkill, renderSlackSkill, renderKnowledgeGraphSkill, renderGcpSkill, renderCloudflareSkill, renderSkillsBlock, appendIntegrationSkills } from '../src/integrations/skill.js';
import { RCA_OPERATING_PREAMBLE } from '@intellilabs/core';
import { startTestDb } from './helpers.js';

describe('renderSlackSkill', () => {
  it('tailors to enabled slack ops and lists channels in scope', () => {
    const out = renderSlackSkill(
      ['integration.slack.reply_in_thread'],
      [{ name: 'general', id: 'C123' }],
    );
    expect(out).toContain('## Slack tools');
    expect(out).toContain('reply in threads');
    expect(out).toContain('triggered this conversation');
    expect(out).toContain('#general (C123)');
    expect(out).not.toContain('post messages');
  });

  it('returns empty string when no slack tools are enabled', () => {
    expect(renderSlackSkill([], [{ name: 'general', id: 'C123' }])).toBe('');
  });
});

describe('renderGithubSkill', () => {
  it('includes only the enabled operation labels and relevant guidance', () => {
    const out = renderGithubSkill(
      ['integration.github.get_file'],
      [{ repo: 'acme/web', ref: 'main' }],
    );
    expect(out).toContain('## GitHub tools');
    expect(out).toContain('read files');
    // ref-hiding note present because get_file is a CODE_READ_TOOL
    expect(out).toContain("You do **not** choose a branch or commit");
    expect(out).toContain('acme/web');
    // tools not in the enabled list should not appear
    expect(out).not.toContain('open issues');
    expect(out).not.toContain('integration.github.create_issue');
  });

  it('includes create_issue guidance when create_issue is enabled, omits ref-hiding note when no code-read tool', () => {
    const out = renderGithubSkill(['integration.github.create_issue'], []);
    expect(out).toContain('open issues');
    expect(out).toContain('`integration.github.create_issue` makes a real change');
    // No code-read tool enabled → ref-hiding note must not appear
    expect(out).not.toContain('You do **not** choose a branch or commit');
    // No repos → no "Repositories in scope" section
    expect(out).not.toContain('Repositories in scope');
  });

  it('returns empty string when no enabled tools match the catalog', () => {
    expect(renderGithubSkill([], [{ repo: 'acme/web', ref: 'main' }])).toBe('');
  });

  it('frames code as the primary source of truth with how/when guidance', () => {
    const out = renderGithubSkill(
      ['integration.github.search_code', 'integration.github.get_file'],
      [{ repo: 'acme/web', ref: 'main' }],
    );
    expect(out.toLowerCase()).toContain('primary source of truth');
    // mentions searching code then reading the file, and citing file:line
    expect(out).toContain('search_code');
    expect(out).toContain('get_file');
    expect(out).toContain('file:line');
  });
});

describe('renderKnowledgeGraphSkill', () => {
  it('lists only enabled ops', () => {
    const s = renderKnowledgeGraphSkill(
      ['integration.knowledge-graph.list_flows', 'integration.knowledge-graph.walkthrough'],
      ['o/r'],
    );
    expect(s).toContain('list business flows');
    expect(s).toContain('o/r');
    expect(s).not.toContain("assess a change's impact"); // blast_radius not enabled
  });

  it('returns empty string with no KG tools', () => {
    expect(renderKnowledgeGraphSkill([], ['o/r'])).toBe('');
  });
});

describe('renderGcpSkill', () => {
  it('renders enabled signals and lists specific projects with role labels', () => {
    const out = renderGcpSkill(
      ['integration.gcp.list_scope', 'integration.gcp.query_metrics', 'integration.gcp.query_logs'],
      { unrestricted: false, signals: ['monitoring', 'logging'], projects: [{ gcpProjectId: 'acme-prod', label: 'Production' }] },
    );
    expect(out).toContain('PromQL');
    expect(out).toContain('acme-prod (Production)');
    expect(out).toContain('list_scope');
    expect(out).not.toContain('Cloud Trace filter'); // list_traces not enabled
    expect(out).not.toContain('integration.gcp.list_targets'); // old tool gone
    expect(out).not.toMatch(/Always pass `target`/); // old param gone
    expect(out).not.toContain('unrestricted'); // specific scope → no unrestricted wording
  });

  it('describes only granted signals', () => {
    const out = renderGcpSkill(
      ['integration.gcp.query_logs', 'integration.gcp.query_metrics'],
      { unrestricted: false, signals: ['logging'], projects: [{ gcpProjectId: 'acme-prod', label: null }] },
    );
    expect(out).toMatch(/acme-prod/);
    expect(out).not.toMatch(/PromQL/); // monitoring not granted → no metrics bullet/op
  });

  it('shows recipe tools when their signal is granted', () => {
    const out = renderGcpSkill(
      ['integration.gcp.error_rate_summary', 'integration.gcp.latency_summary', 'integration.gcp.log_error_summary'],
      { unrestricted: false, signals: ['monitoring', 'logging'], projects: [{ gcpProjectId: 'acme-prod', label: null }] },
    );
    expect(out).toContain('summarize request error rates');
    expect(out).toContain('summarize request latency percentiles');
    expect(out).toContain('summarize severity>=ERROR log entries');
    expect(out).toContain('Prefer the purpose-built RCA recipes');
  });

  it('gates recipe tools by their connection signal', () => {
    const out = renderGcpSkill(
      ['integration.gcp.error_rate_summary', 'integration.gcp.log_error_summary'],
      { unrestricted: false, signals: ['logging'], projects: [{ gcpProjectId: 'acme-prod', label: null }] },
    );
    expect(out).toContain('summarize severity>=ERROR log entries'); // logging recipe shown
    expect(out).not.toContain('summarize request error rates'); // monitoring recipe hidden
  });

  it('always shows list_scope/describe_datasets when bound (signal-less)', () => {
    const out = renderGcpSkill(
      ['integration.gcp.list_scope', 'integration.gcp.describe_datasets'],
      { unrestricted: false, signals: [], projects: [{ gcpProjectId: 'acme-prod', label: null }] },
    );
    expect(out).toContain('list_scope');
    expect(out).toContain('describe_datasets');
  });

  it('uses unrestricted wording when no projects are configured', () => {
    const out = renderGcpSkill(
      ['integration.gcp.list_scope', 'integration.gcp.query_metrics'],
      { unrestricted: true, signals: ['monitoring'], projects: [] },
    );
    expect(out).toMatch(/unrestricted/);
    expect(out).toContain('any GCP project the connection can access');
    expect(out).toContain("connection's default project");
  });

  it('returns empty when no gcp tools are enabled', () => {
    expect(renderGcpSkill([], { unrestricted: true, signals: ['monitoring'], projects: [] })).toBe('');
  });

  it('gives metrics-then-logs-then-traces how/when guidance', () => {
    const out = renderGcpSkill(
      ['integration.gcp.error_rate_summary', 'integration.gcp.latency_summary', 'integration.gcp.log_error_summary', 'integration.gcp.query_logs', 'integration.gcp.list_traces', 'integration.gcp.get_trace'],
      { unrestricted: false, signals: ['monitoring', 'logging', 'trace'], projects: [{ gcpProjectId: 'acme-prod', label: null }] },
    );
    // Confirms the metrics → logs → traces workflow framing
    expect(out.toLowerCase()).toMatch(/metrics.*logs.*traces/s);
    expect(out).toContain('error_rate_summary');
    expect(out).toContain('log_error_summary');
  });
});

describe('renderCloudflareSkill', () => {
  it('mentions graphql, worker logs, and error/summary recipes with how/when guidance', () => {
    const out = renderCloudflareSkill(
      ['integration.cloudflare.http_error_summary', 'integration.cloudflare.latency_summary', 'integration.cloudflare.query_graphql', 'integration.cloudflare.query_worker_logs', 'integration.cloudflare.worker_errors'],
      { account: 'acct1', unrestricted: false, resources: [{ kind: 'zone', name: 'acme.com' }] },
    );
    expect(out).toContain('query_graphql');
    expect(out).toContain('query_worker_logs');
    expect(out).toContain('http_error_summary');
    expect(out).toContain('worker_errors');
    // how/when: start with recipes, drop to graphql for the rest
    expect(out).toContain('Prefer the purpose-built RCA recipes');
  });
});

describe('appendIntegrationSkills', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let db: Db;
  let projectId: string;
  let orgId: string;

  beforeAll(async () => {
    t = await startTestDb();
    db = t.db;

    // Seed org + project + github integration + project repo
    const org = await createOrgWithOwner(db, { name: 'Acme', slug: 'acme', userId: 'u1' });
    orgId = org.id;

    const proj = await createProject(db, org.id, { name: 'Web', slug: 'web' });
    projectId = proj.id;

    // Insert integration directly (no secret needed — appendIntegrationSkills never decrypts)
    await upsertIntegration(db, {
      orgId: org.id,
      provider: 'github',
      mode: 'pat',
      connectedByUserId: 'u1',
      metadata: {},
    });
    const intg = await getIntegration(db, org.id, 'github');

    await addProjectRepo(db, {
      projectId: proj.id,
      orgIntegrationId: intg!.id,
      repoFullName: 'acme/web',
      defaultBranch: 'main',
      addedByUserId: 'u1',
    });
  });

  afterAll(async () => { await t.stop(); });

  it('appends one system message mentioning acme/web when get_file is enabled', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['integration.github.get_file'], base);
    expect(out.length).toBe(base.length + 1);
    const injected = out[out.length - 1]!;
    expect(injected.role).toBe('system');
    expect(injected.content).toContain('acme/web');
  });

  it('returns base unchanged when enabledTools has no integration.github.* entries', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['mcp.foo', 'builtin.add'], base);
    expect(out).toEqual(base);
  });

  it('appends a system message containing Knowledge Graph tools when a KG tool is enabled', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['integration.knowledge-graph.list_flows'], base);
    expect(out.length).toBe(base.length + 1);
    const injected = out[out.length - 1]!;
    expect(injected.role).toBe('system');
    expect(injected.content).toContain('Knowledge Graph tools');
  });

  it('appends a memory-recall system message when memory.recall is in enabledTools', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['memory.recall'], base);
    expect(out.length).toBe(base.length + 1);
    const injected = out[out.length - 1]!;
    expect(injected.role).toBe('system');
    expect(injected.content).toContain('memory.recall');
  });

  it('does NOT append a memory-recall message when memory.recall is absent', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['mcp.foo', 'builtin.add'], base);
    const hasMemory = out.some((m) => m.content.includes('memory.recall'));
    expect(hasMemory).toBe(false);
  });

  it('inserts the RCA preamble exactly once, right after the persona, when preamble:true', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['integration.github.get_file'], base, { preamble: true });
    // persona stays first; preamble is the second message
    expect(out[0]).toEqual(base[0]);
    expect(out[1]?.role).toBe('system');
    expect(out[1]?.content).toBe(RCA_OPERATING_PREAMBLE);
    // exactly once
    const count = out.filter((m) => m.content === RCA_OPERATING_PREAMBLE).length;
    expect(count).toBe(1);
    // integration skill blocks still come after the preamble
    expect(out.some((m) => m.content.includes('acme/web'))).toBe(true);
  });

  it('does NOT insert the RCA preamble by default (system-agent route passes preamble:false)', async () => {
    const base = [
      { role: 'system' as const, content: 'slack system agent persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const withFlag = await appendIntegrationSkills(db, projectId, ['integration.github.get_file'], base, { preamble: false });
    expect(withFlag.some((m) => m.content === RCA_OPERATING_PREAMBLE)).toBe(false);
    // and the default (no opts) also omits it
    const noOpts = await appendIntegrationSkills(db, projectId, ['integration.github.get_file'], base);
    expect(noOpts.some((m) => m.content === RCA_OPERATING_PREAMBLE)).toBe(false);
  });

  it('appends a ## Skills block listing attached skills when assistantId is passed', async () => {
    const assistant = await createAssistant(db, projectId, {
      name: 'SkillBot',
      persona: 'You are helpful.',
      model: 'gemini-2.0-flash',
      enabledTools: ['skill.load'],
      isLead: false,
    });
    const skill = await createSkill(db, {
      orgId,
      projectId,
      name: 'rollback',
      description: 'how to roll back',
      body: 'Step 1: ...',
    });
    await setAttachedSkills(db, assistant.id, [skill.id]);

    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['skill.load'], base, { assistantId: assistant.id });
    const injected = out[out.length - 1]!;
    expect(injected.role).toBe('system');
    expect(injected.content).toContain('## Skills');
    expect(injected.content).toContain('rollback: how to roll back');
    expect(injected.content).toContain('skill.load');
  });

  it('does NOT append a ## Skills block when the assistant has no attached skills', async () => {
    const assistant = await createAssistant(db, projectId, {
      name: 'EmptySkillBot',
      persona: 'You are helpful.',
      model: 'gemini-2.0-flash',
      enabledTools: [],
      isLead: false,
    });

    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['skill.load'], base, { assistantId: assistant.id });
    const hasSkillsBlock = out.some((m) => m.content.includes('## Skills'));
    expect(hasSkillsBlock).toBe(false);
  });
});
