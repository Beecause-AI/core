import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import {
  createSkill, listSkills, updateSkill, deleteSkill,
  listAttachedSkills, setAttachedSkills, loadSkillBody,
} from '../../src/repos/agent-skills.js';

const store = testStore('agent-skills');
const db = store.db;
const orgId = 'o';
const projectId = 'p';

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('agent-skills repo (Firestore)', () => {
  it('create → list (ordered by name) with defaults', async () => {
    const b = await createSkill(db, { orgId, projectId, name: 'beta' });
    const a = await createSkill(db, { orgId, projectId, name: 'alpha', description: 'd', body: 'body-a' });
    expect(b.description).toBe('');
    const list = await listSkills(db, projectId);
    expect(list.map((s) => s.name)).toEqual(['alpha', 'beta']);
    expect(list.find((s) => s.id === a.id)!.body).toBe('body-a');
  });

  it('updateSkill is project-scoped; returns null cross-project', async () => {
    const s = await createSkill(db, { orgId, projectId, name: 'edit' });
    expect((await updateSkill(db, projectId, s.id, { description: 'new' }))?.description).toBe('new');
    expect(await updateSkill(db, 'other-project', s.id, { description: 'x' })).toBeNull();
  });

  it('deleteSkill is project-scoped', async () => {
    const s = await createSkill(db, { orgId, projectId, name: 'del' });
    expect(await deleteSkill(db, 'other-project', s.id)).toBe(false);
    expect(await deleteSkill(db, projectId, s.id)).toBe(true);
    expect(await deleteSkill(db, projectId, s.id)).toBe(false);
  });

  it('setAttachedSkills replaces the attached set; listAttachedSkills stitches name+desc ordered', async () => {
    const s1 = await createSkill(db, { orgId, projectId, name: 'zeta', description: 'dz' });
    const s2 = await createSkill(db, { orgId, projectId, name: 'alpha', description: 'da' });
    const s3 = await createSkill(db, { orgId, projectId, name: 'mid', description: 'dm' });

    await setAttachedSkills(db, 'asst-1', [s1.id, s2.id]);
    let attached = await listAttachedSkills(db, 'asst-1');
    expect(attached.map((a) => a.name)).toEqual(['alpha', 'zeta']);
    expect(attached.find((a) => a.id === s2.id)!.description).toBe('da');

    // Replace: now only s3 attached.
    await setAttachedSkills(db, 'asst-1', [s3.id]);
    attached = await listAttachedSkills(db, 'asst-1');
    expect(attached.map((a) => a.name)).toEqual(['mid']);

    // Empty set clears.
    await setAttachedSkills(db, 'asst-1', []);
    expect(await listAttachedSkills(db, 'asst-1')).toHaveLength(0);

    // join doc-id convention is `${assistantId}_${skillId}`
    await setAttachedSkills(db, 'asst-2', [s1.id]);
    expect((await col(db, 'assistant_skills').doc(`asst-2_${s1.id}`).get()).exists).toBe(true);
  });

  it('loadSkillBody returns body only if attached + in the project', async () => {
    const s = await createSkill(db, { orgId, projectId, name: 'runbook', body: 'do the thing' });
    expect(await loadSkillBody(db, projectId, 'asst-x', 'runbook')).toBeNull(); // not attached
    await setAttachedSkills(db, 'asst-x', [s.id]);
    expect(await loadSkillBody(db, projectId, 'asst-x', 'runbook')).toBe('do the thing');
    expect(await loadSkillBody(db, 'wrong-project', 'asst-x', 'runbook')).toBeNull();
    expect(await loadSkillBody(db, projectId, 'asst-x', 'nope')).toBeNull();
  });
});
