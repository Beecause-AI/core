import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { createOrgWithOwner, createProject, upsertIntegration, getIntegration, addProjectRepo } from '@intellilabs/core';
import type { Db } from '@intellilabs/core';
import { renderGithubIssueSkill, appendIntegrationSkills } from '../src/integrations/skill.js';
import { startTestDb } from './helpers.js';

describe('renderGithubIssueSkill', () => {
  it('mentions offer_github_issue', () => {
    const out = renderGithubIssueSkill();
    expect(out).toContain('offer_github_issue');
  });

  it('mentions fixable', () => {
    const out = renderGithubIssueSkill();
    expect(out).toContain('fixable');
  });

  it('includes the heading', () => {
    const out = renderGithubIssueSkill();
    expect(out).toContain('## Raising a fix issue');
  });
});

describe('appendIntegrationSkills with offer_github_issue', () => {
  let t: Awaited<ReturnType<typeof startTestDb>>;
  let db: Db;
  let projectId: string;

  beforeAll(async () => {
    t = await startTestDb();
    db = t.db;

    const org = await createOrgWithOwner(db, { name: 'IssueOrg', slug: 'issue-org', userId: 'u1' });
    const proj = await createProject(db, org.id, { name: 'IssueProj', slug: 'issue-proj' });
    projectId = proj.id;

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
      repoFullName: 'issue-org/app',
      defaultBranch: 'main',
      addedByUserId: 'u1',
    });
  });

  afterAll(async () => { await t.stop(); });

  it('pushes a system message containing "Raising a fix issue" when offer_github_issue is in enabledTools', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['integration.github.offer_github_issue'], base);
    const injected = out.find((m) => m.content.includes('Raising a fix issue'));
    expect(injected).toBeTruthy();
    expect(injected!.role).toBe('system');
  });

  it('does NOT append the issue skill block when offer_github_issue is absent', async () => {
    const base = [
      { role: 'system' as const, content: 'persona' },
      { role: 'user' as const, content: 'hi' },
    ];
    const out = await appendIntegrationSkills(db, projectId, ['integration.github.get_file'], base);
    const has = out.some((m) => m.content.includes('Raising a fix issue'));
    expect(has).toBe(false);
  });
});
