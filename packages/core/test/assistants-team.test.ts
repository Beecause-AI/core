import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testStore } from './store/emulator.js';
import { createOrgWithOwner } from '../src/repos/orgs.js';
import { createProject } from '../src/repos/projects.js';
import { createAssistant, getAssistant, updateAssistant } from '../src/repos/assistants.js';

const t = testStore('assistants-team');
let projectId: string;

beforeAll(async () => {
  const userId = randomUUID();
  const org = await createOrgWithOwner(t.db, { name: 'Team Org', slug: `team-${userId.slice(0, 8)}`, userId });
  const project = await createProject(t.db, org.id, { name: 'P', slug: `team-p-${userId.slice(0, 8)}` });
  projectId = project.id;
});
afterAll(() => t.close());

describe('assistant team fields', () => {
  it('creates with team defaults (not lead)', async () => {
    const a = await createAssistant(t.db, projectId, { name: 'Worker' });
    expect(a.isLead).toBe(false);
  });

  it('allows multiple leads in a project (is_lead is a non-unique flag)', async () => {
    const a = await createAssistant(t.db, projectId, { name: 'A', isLead: true });
    const b = await createAssistant(t.db, projectId, { name: 'B' });
    await updateAssistant(t.db, projectId, b.id, { isLead: true });
    expect((await getAssistant(t.db, projectId, a.id))!.isLead).toBe(true);
    expect((await getAssistant(t.db, projectId, b.id))!.isLead).toBe(true);
  });
});
