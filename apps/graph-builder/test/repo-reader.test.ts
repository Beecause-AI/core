import { describe, it, expect } from 'vitest';
import { makeRepoReader } from '../src/repo-reader.js';

const client = {
  getRefInfo: async () => ({ ref: 'main', sha: 'deadbeef' }),
  listTree: async () => ({ truncated: false, entries: [
    { path: 'src/a.ts', type: 'blob', sha: 's1', size: 10 },
    { path: 'big.bin', type: 'blob', sha: 's2', size: 999999999 },
    { path: 'README.md', type: 'blob', sha: 's4', size: 5 },
    { path: 'src', type: 'tree', sha: 's3' },
  ] }),
  getFile: async (_c: any, _repo: string, path: string) => ({ text: `content of ${path}`, sha: 'x' }),
} as any;

describe('RepoReader', () => {
  it('lists parseable blobs under the size cap, at the resolved sha', async () => {
    const r = await makeRepoReader({ client, creds: { mode: 'pat', token: 't' }, repo: 'acme/web', ref: 'main', maxFileBytes: 1000, maxFiles: 100 });
    expect(r.commitSha).toBe('deadbeef');
    // big.bin over cap; README.md not a parseable code ext; tree skipped
    expect(r.files.map((f) => f.path)).toEqual(['src/a.ts']);
    expect(await r.read('src/a.ts')).toContain('content of src/a.ts');
    expect(r.truncated).toBe(false);
  });

  it('marks truncated when the file cap is exceeded', async () => {
    const many = { ...client, listTree: async () => ({ truncated: false, entries: [
      { path: 'a.ts', type: 'blob', sha: '1', size: 1 },
      { path: 'b.ts', type: 'blob', sha: '2', size: 1 },
      { path: 'c.ts', type: 'blob', sha: '3', size: 1 },
    ] }) };
    const r = await makeRepoReader({ client: many, creds: {}, repo: 'a/b', ref: 'main', maxFileBytes: 1000, maxFiles: 2 });
    expect(r.files.length).toBe(2);
    expect(r.truncated).toBe(true);
  });

  it('read returns null when getFile throws (degrade)', async () => {
    const c2 = { ...client, getFile: async () => { throw new Error('boom'); } };
    const r = await makeRepoReader({ client: c2, creds: {}, repo: 'a/b', ref: 'main', maxFileBytes: 1000, maxFiles: 100 });
    expect(await r.read('src/a.ts')).toBeNull();
  });
});
