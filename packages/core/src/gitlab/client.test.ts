import { describe, it, expect } from 'vitest';
import { makeGitlabClientForTest, apiBaseFor } from './client.js';

type Call = { url: string; init?: any };
function fakeFetch(routes: Record<string, unknown>) {
  const calls: Call[] = [];
  const impl = async (url: string, init?: any) => {
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
    return { ok: true, status: 200, json: async () => routes[key], text: async () => JSON.stringify(routes[key]) };
  };
  return { impl, calls };
}
const creds = { token: 'glpat-x' };

describe('apiBaseFor', () => {
  it('defaults to gitlab.com', () => expect(apiBaseFor()).toBe('https://gitlab.com/api/v4'));
  it('uses a self-managed origin', () => expect(apiBaseFor('https://gl.acme.com/')).toBe('https://gl.acme.com/api/v4'));
});

describe('gitlab client', () => {
  it('probe hits /user and returns the username', async () => {
    const { impl, calls } = fakeFetch({ '/api/v4/user': { username: 'octo' } });
    const out = await makeGitlabClientForTest(impl as any).probe(creds);
    expect(out.ok).toBe(true);
    expect(out.accountLabel).toBe('octo');
    expect(calls[0]!.init.headers['private-token']).toBe('glpat-x');
  });

  it('listReposDetailed maps path_with_namespace + visibility and paginates by length', async () => {
    const page = Array.from({ length: 100 }, (_, i) => ({ path_with_namespace: `g/r${i}`, default_branch: 'main', visibility: 'private' }));
    const { impl } = fakeFetch({ '/api/v4/projects': page });
    const out = await makeGitlabClientForTest(impl as any).listReposDetailed({ ...creds, page: 1 });
    expect(out.repos[0]).toEqual({ fullName: 'g/r0', defaultBranch: 'main', private: true });
    expect(out.nextPage).toBe(2);
  });

  it('getFile decodes base64 content and url-encodes the project id + path', async () => {
    const { impl, calls } = fakeFetch({ '/repository/files/': { content: Buffer.from('hello').toString('base64'), encoding: 'base64', blob_id: 'b1' } });
    const out = await makeGitlabClientForTest(impl as any).getFile(creds, 'grp/sub/proj', 'src/a.ts', 'main');
    expect(out).toEqual({ text: 'hello', sha: 'b1' });
    expect(calls[0]!.url).toContain('/api/v4/projects/grp%2Fsub%2Fproj/repository/files/src%2Fa.ts');
    expect(calls[0]!.url).toContain('ref=main');
  });

  it('getRefInfo returns the commit id as sha', async () => {
    const { impl } = fakeFetch({ '/repository/commits/': { id: 'deadbeef' } });
    expect(await makeGitlabClientForTest(impl as any).getRefInfo(creds, 'g/r', 'main')).toEqual({ ref: 'main', sha: 'deadbeef' });
  });

  it('createIssue posts title+description and returns iid + web_url', async () => {
    const { impl, calls } = fakeFetch({ '/issues': { iid: 7, web_url: 'https://gitlab.com/g/r/-/issues/7' } });
    const out = await makeGitlabClientForTest(impl as any).createIssue(creds, 'g/r', 'T', 'B');
    expect(out).toEqual({ number: 7, url: 'https://gitlab.com/g/r/-/issues/7' });
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body)).toEqual({ title: 'T', description: 'B' });
  });

  it('getMergeRequest pulls description + concatenated changes diff', async () => {
    const { impl } = fakeFetch({
      '/merge_requests/3/changes': { iid: 3, title: 'MR', state: 'opened', description: 'd', changes: [{ diff: '@@ a' }, { diff: '@@ b' }] },
    });
    const out = await makeGitlabClientForTest(impl as any).getMergeRequest(creds, 'g/r', 3);
    expect(out).toEqual({ number: 3, title: 'MR', state: 'opened', body: 'd', diff: '@@ a\n@@ b' });
  });
});
