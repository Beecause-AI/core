import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { testStore, wipe } from './emulator.js';
import { searchCatalog, getCatalogRepo, upsertCatalogRepo, removeCatalogRepo } from '../../src/repos/github-catalog.js';

const store = testStore('github-catalog');
const db = store.db;

let intgSeq = 0;
function newIntg(): string { return `intg-${intgSeq++}`; }

async function seedRepos(intgId: string, names: string[]) {
  for (const n of names) await upsertCatalogRepo(db, intgId, { repoFullName: n, defaultBranch: 'main', private: false });
}

beforeEach(() => wipe(db));
afterAll(() => store.close());

describe('searchCatalog', () => {
  it('filters by q (case-insensitive substring) and reports total', async () => {
    const intg = newIntg();
    await seedRepos(intg, ['acme/web', 'acme/api', 'acme/payments', 'other/thing']);
    const res = await searchCatalog(db, intg, { q: 'PAY', limit: 50 });
    expect(res.rows.map((r) => r.repoFullName)).toEqual(['acme/payments']);
    expect(res.total).toBe(1);
    expect(res.nextCursor).toBeNull();
  });

  it('paginates with a keyset cursor, ordered by repoFullName', async () => {
    const intg = newIntg();
    await seedRepos(intg, ['a/1', 'a/2', 'a/3', 'a/4', 'a/5']);
    const p1 = await searchCatalog(db, intg, { limit: 2 });
    expect(p1.rows.map((r) => r.repoFullName)).toEqual(['a/1', 'a/2']);
    expect(p1.total).toBe(5);
    expect(p1.nextCursor).toBe('a/2');
    const p2 = await searchCatalog(db, intg, { cursor: p1.nextCursor, limit: 2 });
    expect(p2.rows.map((r) => r.repoFullName)).toEqual(['a/3', 'a/4']);
    expect(p2.total).toBe(5);
    expect(p2.nextCursor).toBe('a/4');
    const p3 = await searchCatalog(db, intg, { cursor: p2.nextCursor, limit: 2 });
    expect(p3.rows.map((r) => r.repoFullName)).toEqual(['a/5']);
    expect(p3.nextCursor).toBeNull();
  });

  it('scopes to the given integration only', async () => {
    const a = newIntg(); const b = newIntg();
    await seedRepos(a, ['a/x']); await seedRepos(b, ['b/y']);
    expect((await searchCatalog(db, a, {})).rows.map((r) => r.repoFullName)).toEqual(['a/x']);
  });
});

describe('getCatalogRepo', () => {
  it('returns the row for an exact repoFullName, or null', async () => {
    const intg = newIntg();
    await upsertCatalogRepo(db, intg, { repoFullName: 'acme/web', defaultBranch: 'dev', private: true });
    expect((await getCatalogRepo(db, intg, 'acme/web'))?.defaultBranch).toBe('dev');
    expect(await getCatalogRepo(db, intg, 'acme/nope')).toBeNull();
  });

  it('upsert updates branch/private on conflict (keyed by integration+repo)', async () => {
    const intg = newIntg();
    await upsertCatalogRepo(db, intg, { repoFullName: 'acme/web', defaultBranch: 'main', private: false });
    await upsertCatalogRepo(db, intg, { repoFullName: 'acme/web', defaultBranch: 'dev', private: true });
    expect((await searchCatalog(db, intg, {})).total).toBe(1);
    const row = await getCatalogRepo(db, intg, 'acme/web');
    expect(row?.defaultBranch).toBe('dev');
    expect(row?.private).toBe(true);
  });
});

describe('upsert/remove (webhook path) still work', () => {
  it('upserts and removes a single repo', async () => {
    const intg = newIntg();
    await upsertCatalogRepo(db, intg, { repoFullName: 'acme/new', defaultBranch: 'main', private: false });
    expect((await searchCatalog(db, intg, {})).total).toBe(1);
    await removeCatalogRepo(db, intg, 'acme/new');
    expect((await searchCatalog(db, intg, {})).total).toBe(0);
  });
});
