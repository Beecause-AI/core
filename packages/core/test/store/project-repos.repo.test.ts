import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import {
  listProjectRepos, addProjectRepo, removeProjectRepo, setProjectRepoRef, resolveRepoRef,
} from '../../src/repos/project-repos.js';

const store = testStore('project-repos');
const db = store.db;

beforeEach(() => wipe(db));
afterAll(() => store.close());

const base = (repoFullName: string, defaultBranch: string | null = 'main') => ({
  projectId: 'p1', orgIntegrationId: 'oi1', repoFullName, defaultBranch, addedByUserId: 'u1',
});

describe('project-repos repo (Firestore)', () => {
  it('adds, lists (ordered by repoFullName) and removes', async () => {
    await addProjectRepo(db, base('acme/zeta'));
    const added = await addProjectRepo(db, base('acme/alpha'));
    expect(added.refType).toBeNull();
    expect(added.ref).toBeNull();
    const list = await listProjectRepos(db, 'p1');
    expect(list.map((r) => r.repoFullName)).toEqual(['acme/alpha', 'acme/zeta']);

    expect(await removeProjectRepo(db, 'p1', added.id)).toBe(true);
    expect(await listProjectRepos(db, 'p1')).toHaveLength(1);
    expect(await removeProjectRepo(db, 'p1', added.id)).toBe(false);
    expect(await removeProjectRepo(db, 'other', added.id)).toBe(false);
  });

  it('rejects a duplicate repo in the same project (23505)', async () => {
    await addProjectRepo(db, base('acme/dup', null));
    let err: unknown;
    try { await addProjectRepo(db, base('acme/dup', null)); } catch (e) { err = e; }
    expect((err as { code?: string })?.code).toBe('23505');
  });

  it('sets and reads a per-repo ref', async () => {
    const repo = await addProjectRepo(db, base('acme/web'));
    expect(repo.refType).toBeNull();
    expect(await setProjectRepoRef(db, 'p1', 'acme/web', { refType: 'commit', ref: 'deadbeef' })).toBe(true);
    const rows = await listProjectRepos(db, 'p1');
    expect(rows[0]!.refType).toBe('commit');
    expect(rows[0]!.ref).toBe('deadbeef');
    expect(await setProjectRepoRef(db, 'p1', 'acme/missing', { refType: null, ref: null })).toBe(false);
  });

  it('resolveRepoRef prefers ref, then defaultBranch, then null', () => {
    expect(resolveRepoRef({ ref: 'sha', defaultBranch: 'main' } as never)).toBe('sha');
    expect(resolveRepoRef({ ref: null, defaultBranch: 'main' } as never)).toBe('main');
    expect(resolveRepoRef({ ref: null, defaultBranch: null } as never)).toBeNull();
  });
});
