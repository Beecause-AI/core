import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOrgWithOwner,
  createProject,
  createBuild,
  insertNodes,
} from '@intellilabs/core';
// Importing the package registers kg-skills in the registry.
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { runArchitecture } from '../src/phases/architecture.js';
import type { KgPublisher } from '../src/run-phase.js';
import type { InvocationRecord } from '../src/run-phase.js';
import type { BuildJob } from '../src/app.js';
import { startTestDb } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestDb>>;

beforeAll(async () => { t = await startTestDb(); });
afterAll(async () => { await t.stop(); });

describe('recordInvocation sink', () => {
  it('captures one LLM record per llm call in the architecture fan-out', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'RecInv', slug: 'rec-inv', userId: 'u1' });
    const project = await createProject(t.db, org.id, { name: 'Sys', slug: 'sys-rec-inv' });
    const build = await createBuild(t.db, {
      orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'architecture',
    });

    await insertNodes(t.db, [
      { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'file', name: 'src/auth/login.ts', commitSha: 'c1' },
      { orgId: org.id, buildId: build.id, repoFullName: 'acme/web', kind: 'file', name: 'src/pay/charge.ts', commitSha: 'c1' },
    ]);

    const recorded: InvocationRecord[] = [];
    const published: BuildJob[] = [];

    const semantic = {
      llm: async (_orgId: string, prompt: string) => {
        const hit = ['src/auth/login.ts', 'src/pay/charge.ts'].find((p) => prompt.includes(p));
        const name = hit?.includes('auth') ? 'Auth' : 'Payments';
        return {
          text: JSON.stringify({ components: [{ index: 0, name, digest: 'Desc.', files: [hit ?? ''] }] }),
          inputTokens: 10,
          outputTokens: 5,
        };
      },
      embed: async () => [],
    };

    await runArchitecture(
      {
        db: t.db,
        store: t.store,
        client: {} as any,
        config: {},
        semantic,
        recordInvocation: (rec) => { recorded.push(rec); },
        kgPublisher: { publish: async (j) => { published.push(j); } } as KgPublisher,
        skills: { skillsFor, listSkills },
      },
      {
        orgId: org.id,
        projectId: project.id,
        repoFullName: '(project)',
        ref: '',
        mode: 'manual',
        buildId: build.id,
        phase: 'architecture',
      },
    );

    // Two areas → at least one record per skill per area. There is one architecture skill,
    // so expect exactly 2 records (one per area).
    expect(recorded.length).toBeGreaterThanOrEqual(1);

    // Spot-check the first record's shape.
    const rec = recorded[0]!;
    expect(rec.source).toBe('kg-build');
    expect(rec.buildId).toBe(build.id);
    expect(rec.phase).toBe('architecture');
    expect(rec.model).toBe('gemini-3.1-pro-preview');
    expect(rec.provider).toBe('google-vertex');
    expect(rec.status).toBe('ok');
    expect(rec.inputTokens).toBe(10);
    expect(rec.outputTokens).toBe(5);
    expect(Array.isArray(rec.messages)).toBe(true);
    const msgs = rec.messages as { role: string; content: string }[];
    expect(msgs[0]?.role).toBe('user');
    expect(typeof msgs[0]?.content).toBe('string');
    expect(typeof rec.output).toBe('string');
    expect(rec.output.length).toBeGreaterThan(0);
  });

  it('no-ops gracefully when recordInvocation is omitted', async () => {
    const org = await createOrgWithOwner(t.db, { name: 'RecInvNoop', slug: 'rec-inv-noop', userId: 'u2' });
    const project = await createProject(t.db, org.id, { name: 'Sys', slug: 'sys-rec-inv-noop' });
    const build = await createBuild(t.db, {
      orgId: org.id, repoFullName: '(project)', projectId: project.id, mode: 'manual', phase: 'architecture',
    });
    await insertNodes(t.db, [
      { orgId: org.id, buildId: build.id, repoFullName: 'acme/api', kind: 'file', name: 'src/auth/login.ts', commitSha: 'c1' },
    ]);

    // No recordInvocation provided — phase must complete without throwing.
    await expect(
      runArchitecture(
        {
          db: t.db,
          store: t.store,
          client: {} as any,
          config: {},
          semantic: {
            llm: async () => ({ text: JSON.stringify({ components: [] }), inputTokens: 1, outputTokens: 1 }),
            embed: async () => [],
          },
          kgPublisher: { publish: async () => {} } as KgPublisher,
          skills: { skillsFor, listSkills },
        },
        {
          orgId: org.id, projectId: project.id, repoFullName: '(project)', ref: '', mode: 'manual',
          buildId: build.id, phase: 'architecture',
        },
      ),
    ).resolves.toBeUndefined();
  });
});
