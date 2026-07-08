import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  createAssistant, deleteAssistant, getAssistant, listAssistants, updateAssistant,
  getProjectOrchestrator, deleteAutogenAssistants, markAssistantUserModified,
} from '../../src/repos/assistants.js';

const store = testStore('assistants');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const projectA = 'proj-a';
const projectB = 'proj-b';

describe('assistants repo (Firestore)', () => {
  it('creates with defaults and lists within a project', async () => {
    const a = await createAssistant(db, projectA, { name: 'Helper', persona: 'Friendly SRE' });
    expect(a.projectId).toBe(projectA);
    expect(a.persona).toBe('Friendly SRE');
    expect(a.model).toBe('gemini-3-flash-preview');
    expect(a.enabledTools).toEqual([]);
    expect(a.isLead).toBe(false);
    expect(a.createdAt).toBeInstanceOf(Date);
    expect(a.updatedAt).toBeInstanceOf(Date);
    expect((await listAssistants(db, projectA)).map((x) => x.id)).toContain(a.id);
  });

  it('does not leak across projects', async () => {
    const a = await createAssistant(db, projectA, { name: 'X' });
    expect(await listAssistants(db, projectB)).toEqual([]);
    expect(await getAssistant(db, projectB, a.id)).toBeNull();
    expect(await getAssistant(db, projectA, a.id)).not.toBeNull();
  });

  it('updates only within the project', async () => {
    const a = await createAssistant(db, projectA, { name: 'X' });
    const updated = await updateAssistant(db, projectA, a.id, { persona: 'Grumpy SRE' });
    expect(updated?.persona).toBe('Grumpy SRE');
    expect(await updateAssistant(db, projectB, a.id, { persona: 'x' })).toBeNull();
  });

  it('deletes only within the project', async () => {
    const a = await createAssistant(db, projectA, { name: 'X' });
    expect(await deleteAssistant(db, projectB, a.id)).toBe(false);
    expect(await deleteAssistant(db, projectA, a.id)).toBe(true);
    expect(await listAssistants(db, projectA)).toEqual([]);
  });

  it('getProjectOrchestrator returns the earliest lead', async () => {
    await createAssistant(db, projectA, { name: 'NotLead' });
    const lead1 = await createAssistant(db, projectA, { name: 'Lead1', isLead: true });
    await new Promise((r) => setTimeout(r, 5));
    await createAssistant(db, projectA, { name: 'Lead2', isLead: true });
    const orch = await getProjectOrchestrator(db, projectA);
    expect(orch?.id).toBe(lead1.id);
    expect(await getProjectOrchestrator(db, projectB)).toBeNull();
  });

  it('deleteAutogenAssistants removes only those with a sourceProposalId', async () => {
    await createAssistant(db, projectA, { name: 'Manual' });
    await createAssistant(db, projectA, { name: 'Auto1', sourceProposalId: 'p1' });
    await createAssistant(db, projectA, { name: 'Auto2', sourceProposalId: 'p2' });
    const n = await deleteAutogenAssistants(db, projectA);
    expect(n).toBe(2);
    const remaining = await listAssistants(db, projectA);
    expect(remaining.map((r) => r.name)).toEqual(['Manual']);
  });

  it('markAssistantUserModified flags the agent (within project only)', async () => {
    const a = await createAssistant(db, projectA, { name: 'Auto', sourceProposalId: 'p1' });
    await markAssistantUserModified(db, projectB, a.id); // wrong project → noop
    expect((await getAssistant(db, projectA, a.id))?.userModified).toBe(false);
    await markAssistantUserModified(db, projectA, a.id);
    expect((await getAssistant(db, projectA, a.id))?.userModified).toBe(true);
  });
});
