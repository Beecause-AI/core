import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { col } from '../../src/store/collections.js';
import { toDoc, applyDefaults } from '../../src/store/codec.js';
import {
  ensureDefaultProject, createProject, getProject, renameProject,
  listProjectsForOrg, listManageableProjects, getProjectBySlug, updateProject,
  deleteProject, projectScopeCounts,
} from '../../src/repos/projects.js';

const store = testStore('projects');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

async function seedOrgMember(orgId: string, userId: string, role: 'owner' | 'manager' | 'user') {
  const id = `${orgId}_${userId}`;
  await col(db, 'org_members').doc(id).set(toDoc(applyDefaults({ orgId, userId, role }, id)));
}
async function seedProjectMember(projectId: string, userId: string, role: 'admin' | 'user') {
  const id = `${projectId}_${userId}`;
  await col(db, 'project_members').doc(id).set(toDoc(applyDefaults({ projectId, userId, role }, id)));
}

describe('projects repo (Firestore)', () => {
  it('ensureDefaultProject creates a default project + makes owners/managers admins, idempotent', async () => {
    await seedOrgMember('o1', 'owner1', 'owner');
    await seedOrgMember('o1', 'member1', 'user');

    const project = await ensureDefaultProject(db, 'o1');
    expect(project.slug).toBe('default');

    const members = await col(db, 'project_members').where('projectId', '==', project.id).get();
    const roles = new Map(members.map((d) => [d.data()?.userId, d.data()?.role]));
    expect(roles.get('owner1')).toBe('admin');
    expect(roles.has('member1')).toBe(false);

    const again = await ensureDefaultProject(db, 'o1');
    expect(again.id).toBe(project.id);
    const after = await col(db, 'project_members').where('projectId', '==', project.id).get();
    expect(after.length).toBe(1);
  });

  it('createProject returns the row and enforces unique(orgId, slug)', async () => {
    const p = await createProject(db, 'o1', { name: 'Alpha', slug: 'alpha' });
    expect(p.slug).toBe('alpha');
    expect(p.orgId).toBe('o1');
    expect(p.description).toBe('');

    let err: unknown;
    try { await createProject(db, 'o1', { name: 'Alpha2', slug: 'alpha' }); } catch (e) { err = e; }
    expect((err as { code?: string })?.code).toBe('23505');

    // same slug in a different org is fine
    const p2 = await createProject(db, 'o2', { name: 'Alpha', slug: 'alpha' });
    expect(p2.id).not.toBe(p.id);
  });

  it('getProject scopes by org', async () => {
    const p = await createProject(db, 'o1', { name: 'P', slug: 'p' });
    expect((await getProject(db, 'o1', p.id))?.id).toBe(p.id);
    expect(await getProject(db, 'o2', p.id)).toBeNull();
  });

  it('renameProject / updateProject scoped to org', async () => {
    const p = await createProject(db, 'o1', { name: 'Old', slug: 'old' });
    expect((await renameProject(db, 'o1', p.id, 'New'))?.name).toBe('New');
    expect(await renameProject(db, 'o2', p.id, 'X')).toBeNull();
    const upd = await updateProject(db, 'o1', p.id, { name: 'Site', description: 'd', slug: 'site' });
    expect(upd).toMatchObject({ name: 'Site', description: 'd', slug: 'site' });
    expect(await getProjectBySlug(db, 'o1', 'site')).not.toBeNull();
    expect(await getProjectBySlug(db, 'o1', 'nope')).toBeNull();
  });

  it('listProjectsForOrg: admin sees all (ordered by name), member sees only joined', async () => {
    const p1 = await createProject(db, 'o1', { name: 'Bravo', slug: 'bravo' });
    const p2 = await createProject(db, 'o1', { name: 'Alpha', slug: 'alpha' });
    const adminList = await listProjectsForOrg(db, 'o1', 'admin', true);
    expect(adminList.map((p) => p.name)).toEqual(['Alpha', 'Bravo']);

    await seedProjectMember(p1.id, 'm1', 'user');
    const memberList = await listProjectsForOrg(db, 'o1', 'm1', false);
    expect(memberList.map((p) => p.id)).toEqual([p1.id]);
    expect(memberList.map((p) => p.id)).not.toContain(p2.id);
  });

  it('listManageableProjects: org admin sees all; member sees only project-admin rows', async () => {
    const p1 = await createProject(db, 'o1', { name: 'PA1', slug: 'pa1' });
    const p2 = await createProject(db, 'o1', { name: 'PA2', slug: 'pa2' });
    expect((await listManageableProjects(db, 'o1', 'x', true)).map((p) => p.slug).sort())
      .toEqual(['pa1', 'pa2']);

    await seedProjectMember(p1.id, 'u', 'admin');
    await seedProjectMember(p2.id, 'u', 'user');
    expect((await listManageableProjects(db, 'o1', 'u', false)).map((p) => p.slug)).toEqual(['pa1']);
    expect(await listManageableProjects(db, 'o1', 'nobody', false)).toEqual([]);
  });

  it('deleteProject scoped to org', async () => {
    const p = await createProject(db, 'o1', { name: 'P', slug: 'p' });
    expect(await deleteProject(db, 'o2', p.id)).toBe(false);
    expect(await deleteProject(db, 'o1', p.id)).toBe(true);
    expect(await getProject(db, 'o1', p.id)).toBeNull();
    expect(await deleteProject(db, 'o1', p.id)).toBe(false);
  });

  it('projectScopeCounts counts repos, assistants and members', async () => {
    const p = await createProject(db, 'o1', { name: 'P', slug: 'p' });
    await col(db, 'assistants').doc('a1').set(toDoc(applyDefaults({ projectId: p.id, name: 'A' }, 'a1')));
    await seedProjectMember(p.id, 'm1', 'admin');
    expect(await projectScopeCounts(db, p.id)).toEqual({ repos: 0, assistants: 1, members: 1 });
  });
});
