import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { appJwt, apiBaseFor, makeGithubClientForTest, graphqlUrlFor } from '../src/integrations/github/client.js';

// A single RSA key pair generated once for the entire test module.
// Used by both appJwt and app-mode listReposDetailed tests.
const { publicKey: TEST_PUBLIC_KEY, privateKey: TEST_PRIVATE_KEY_OBJ } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_PRIVATE_KEY_PEM = TEST_PRIVATE_KEY_OBJ.export({ type: 'pkcs1', format: 'pem' }).toString();

function fakeFetch(map: Record<string, unknown>) {
  return async (url: string) => {
    const entry = map[url] ?? Object.entries(map).find(([k]) => url.startsWith(k))?.[1];
    return { ok: entry !== undefined, status: entry !== undefined ? 200 : 404, text: async () => '', json: async () => entry };
  };
}

const fullPage = Array.from({ length: 100 }, (_, i) => ({ full_name: `acme/r${String(i).padStart(3, '0')}`, default_branch: 'main', private: false }));

describe('apiBaseFor', () => {
  it('uses api.github.com for cloud (no baseUrl)', () => {
    expect(apiBaseFor()).toBe('https://api.github.com');
  });
  it('uses /api/v3 for a GHES base url', () => {
    expect(apiBaseFor('https://ghe.example.com')).toBe('https://ghe.example.com/api/v3');
  });
});

describe('appJwt', () => {
  it('produces a verifiable RS256 JWT with iss + exp', () => {
    const now = 1_700_000_000;
    const token = appJwt('4015121', TEST_PRIVATE_KEY_PEM, now);
    const parts = token.split('.');
    const header = parts[0]!;
    const payload = parts[1]!;
    const sig = parts[2]!;
    const b64 = sig.replace(/-/g, '+').replace(/_/g, '/');
    const ok = createVerify('RSA-SHA256').update(`${header}.${payload}`).end().verify(TEST_PUBLIC_KEY, Buffer.from(b64, 'base64'));
    expect(ok).toBe(true);
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    expect(claims).toMatchObject({ iss: '4015121' });
    expect(claims.exp).toBeGreaterThan(claims.iat);
  });
});

describe('listReposDetailed', () => {
  it('maps PAT repos and reports nextPage=null on a short page', async () => {
    const client = makeGithubClientForTest(fakeFetch({
      'https://api.github.com/user/repos?per_page=100&page=1': [
        { full_name: 'acme/a', default_branch: 'main', private: false },
        { full_name: 'acme/b', default_branch: 'dev', private: true },
      ],
    }));
    const res = await client.listReposDetailed({ mode: 'pat', token: 'x', page: 1 });
    expect(res.repos).toEqual([
      { fullName: 'acme/a', defaultBranch: 'main', private: false },
      { fullName: 'acme/b', defaultBranch: 'dev', private: true },
    ]);
    expect(res.nextPage).toBeNull();
  });

  it('reports nextPage when a full page (100) comes back', async () => {
    const client = makeGithubClientForTest(fakeFetch({
      'https://api.github.com/user/repos?per_page=100&page=1': fullPage,
    }));
    const res = await client.listReposDetailed({ mode: 'pat', token: 'x', page: 1 });
    expect(res.repos).toHaveLength(100);
    expect(res.nextPage).toBe(2);
  });

  it('app mode: mints an installation token then fetches /installation/repositories', async () => {
    const client = makeGithubClientForTest(fakeFetch({
      'https://api.github.com/app/installations/42/access_tokens': { token: 'inst-token' },
      'https://api.github.com/installation/repositories?per_page=100&page=1': {
        repositories: [{ full_name: 'acme/app-repo', default_branch: 'main', private: true }],
      },
    }));
    const res = await client.listReposDetailed({
      mode: 'agent_app',
      appId: '1',
      privateKey: TEST_PRIVATE_KEY_PEM,
      installationId: '42',
      page: 1,
    });
    expect(res.repos).toEqual([{ fullName: 'acme/app-repo', defaultBranch: 'main', private: true }]);
    expect(res.nextPage).toBeNull();
  });
});

describe('github client content', () => {
  it('getFile decodes base64 content at a ref', async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toContain('/repos/acme/web/contents/README.md');
      expect(url).toContain('ref=main');
      return { ok: true, status: 200, text: async () => '', json: async () => ({ content: Buffer.from('hello').toString('base64'), encoding: 'base64', sha: 'abc' }) };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    const r = await c.getFile({ mode: 'pat', token: 't' }, 'acme/web', 'README.md', 'main');
    expect(r.text).toBe('hello');
    expect(r.sha).toBe('abc');
  });

  it('listDirectory maps entries and hits the correct URL', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => [{ name: 'a.ts', path: 'src/a.ts', type: 'file' }],
      };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    const entries = await c.listDirectory({ mode: 'pat', token: 't' }, 'acme/web', 'src', 'main');
    expect(entries).toEqual([{ name: 'a.ts', path: 'src/a.ts', type: 'file' }]);
    expect(capturedUrl).toContain('/contents/src');
    expect(capturedUrl).toContain('ref=main');
  });

  it('getFile rejects on a 404 error response', async () => {
    const fetchImpl = async (_url: string) => ({
      ok: false, status: 404, text: async () => '', json: async () => ({}),
    });
    const c = makeGithubClientForTest(fetchImpl as any);
    await expect(c.getFile({ mode: 'pat', token: 't' }, 'acme/web', 'missing.md', 'main'))
      .rejects.toThrow('github get_file 404');
  });

  it('getFile URL-encodes path segments with spaces', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return {
        ok: true, status: 200, text: async () => '',
        json: async () => ({ content: Buffer.from('').toString('base64'), encoding: 'base64', sha: 'def' }),
      };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    await c.getFile({ mode: 'pat', token: 't' }, 'acme/web', 'docs/my file.md', 'main');
    expect(capturedUrl).toContain('my%20file.md');
    expect(capturedUrl).not.toContain('my file.md');
  });
});

describe('github client tree', () => {
  it('listTree returns blob paths with sha + size and the truncated flag', async () => {
    const fetchImpl = async (url: string) => {
      expect(url).toContain('/repos/acme/web/git/trees/main?recursive=1');
      return { ok: true, status: 200, text: async () => '', json: async () => ({
        truncated: false,
        tree: [
          { path: 'src/a.ts', type: 'blob', sha: 's1', size: 10 },
          { path: 'src', type: 'tree', sha: 's2' },
        ],
      }) };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    const r = await c.listTree({ mode: 'pat', token: 't' }, 'acme/web', 'main');
    expect(r.truncated).toBe(false);
    expect(r.entries).toEqual([
      { path: 'src/a.ts', type: 'blob', sha: 's1', size: 10 },
      { path: 'src', type: 'tree', sha: 's2', size: undefined },
    ]);
  });
});

describe('github client issues', () => {
  it('createIssue posts title+body and returns number+url', async () => {
    const fetchImpl = async (url: string, init: any) => {
      expect(url).toContain('/repos/acme/web/issues');
      expect(init.method).toBe('POST');
      expect(JSON.parse(init.body)).toEqual({ title: 'Bug', body: 'broken' });
      return { ok: true, status: 201, text: async () => '', json: async () => ({ number: 7, html_url: 'https://gh/acme/web/issues/7' }) };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    const r = await c.createIssue({ mode: 'pat', token: 't' }, 'acme/web', 'Bug', 'broken');
    expect(r.number).toBe(7);
    expect(r.url).toContain('/issues/7');
  });
});

describe('graphqlUrlFor', () => {
  it('uses api.github.com/graphql for cloud', () => {
    expect(graphqlUrlFor()).toBe('https://api.github.com/graphql');
  });
  it('uses /api/graphql for GHES', () => {
    expect(graphqlUrlFor('https://ghe.example.com')).toBe('https://ghe.example.com/api/graphql');
  });
});

describe('createIssue', () => {
  it('returns number, url, and nodeId', async () => {
    const client = makeGithubClientForTest(async () => ({
      ok: true, status: 201, text: async () => '',
      json: async () => ({ number: 7, html_url: 'https://github.com/acme/api/issues/7', node_id: 'I_node7' }),
    }));
    const r = await client.createIssue({ mode: 'pat', token: 't' }, 'acme/api', 'T', 'B');
    expect(r).toEqual({ number: 7, url: 'https://github.com/acme/api/issues/7', nodeId: 'I_node7' });
  });
});

describe('github client commits', () => {
  it('listCommits builds the correct URL with optional query params', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '', json: async () => [] };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    await c.listCommits({ mode: 'pat', token: 't' }, 'acme/web', { path: 'src/foo.ts', since: '2024-01-01T00:00:00Z', perPage: 10 });
    expect(capturedUrl).toContain('/repos/acme/web/commits');
    expect(capturedUrl).toContain('path=src%2Ffoo.ts');
    expect(capturedUrl).toContain('since=2024-01-01');
    expect(capturedUrl).toContain('per_page=10');
  });

  it('listCommits defaults per_page=20 when not specified', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '', json: async () => [] };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    await c.listCommits({ mode: 'pat', token: 't' }, 'acme/web', {});
    expect(capturedUrl).toContain('per_page=20');
  });

  it('listCommits maps response to compact shape using login over name', async () => {
    const commit = {
      sha: 'abc1234567890abc',
      commit: {
        message: 'fix: something broken\n\nLonger body here',
        author: { name: 'Alice Smith', date: '2024-01-15T10:00:00Z' },
      },
      author: { login: 'alice' },
      html_url: 'https://github.com/acme/web/commit/abc1234567890abc',
    };
    const c = makeGithubClientForTest(async () => ({ ok: true, status: 200, text: async () => '', json: async () => [commit] }));
    const result = await c.listCommits({ mode: 'pat', token: 't' }, 'acme/web', {});
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      sha: 'abc1234567890abc',
      shortSha: 'abc1234',
      message: 'fix: something broken',
      author: 'alice',
      date: '2024-01-15T10:00:00Z',
      url: 'https://github.com/acme/web/commit/abc1234567890abc',
    });
  });

  it('listCommits falls back to commit.author.name when no GitHub user login', async () => {
    const commit = {
      sha: 'def567',
      commit: {
        message: 'chore: bump deps',
        author: { name: 'Bot', date: '2024-02-01T00:00:00Z' },
      },
      author: null,
      html_url: 'https://github.com/acme/web/commit/def567',
    };
    const c = makeGithubClientForTest(async () => ({ ok: true, status: 200, text: async () => '', json: async () => [commit] }));
    const result = await c.listCommits({ mode: 'pat', token: 't' }, 'acme/web', {});
    expect(result[0]!.author).toBe('Bot');
  });

  it('getCommit returns sha, message, author, date, url, stats, and files with patches', async () => {
    const body = {
      sha: 'abc123full',
      commit: { message: 'feat: add widget', author: { name: 'Bob', date: '2024-03-01T12:00:00Z' } },
      author: { login: 'bob' },
      html_url: 'https://github.com/acme/web/commit/abc123full',
      stats: { additions: 10, deletions: 3, total: 13 },
      files: [
        { filename: 'src/widget.ts', status: 'added', additions: 10, deletions: 3, patch: '+export function widget() {}' },
      ],
    };
    const c = makeGithubClientForTest(async () => ({ ok: true, status: 200, text: async () => '', json: async () => body }));
    const result = await c.getCommit({ mode: 'pat', token: 't' }, 'acme/web', 'abc123full');
    expect(result.sha).toBe('abc123full');
    expect(result.message).toBe('feat: add widget');
    expect(result.author).toBe('bob');
    expect(result.stats).toEqual({ additions: 10, deletions: 3, total: 13 });
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toMatchObject({ filename: 'src/widget.ts', status: 'added', additions: 10, deletions: 3, patch: '+export function widget() {}' });
  });

  it('getCommit caps oversized patch across all files', async () => {
    const bigPatch = 'x'.repeat(60_000);
    const body = {
      sha: 'huge99',
      commit: { message: 'huge commit', author: { name: 'Carol', date: '2024-04-01T00:00:00Z' } },
      author: null,
      html_url: 'https://github.com/acme/web/commit/huge99',
      stats: { additions: 2000, deletions: 0, total: 2000 },
      files: [
        { filename: 'big.ts', status: 'modified', additions: 2000, deletions: 0, patch: bigPatch },
      ],
    };
    const c = makeGithubClientForTest(async () => ({ ok: true, status: 200, text: async () => '', json: async () => body }));
    const result = await c.getCommit({ mode: 'pat', token: 't' }, 'acme/web', 'huge99');
    // Patch must be truncated to at most the cap (50_000 chars)
    expect(result.files[0]!.patch!.length).toBeLessThanOrEqual(50_000);
    expect(result.files[0]!.patch!.length).toBeLessThan(bigPatch.length);
  });

  it('getCommit rejects with an error when the response is not OK', async () => {
    const c = makeGithubClientForTest(async () => ({ ok: false, status: 422, text: async () => '', json: async () => ({}) }));
    await expect(c.getCommit({ mode: 'pat', token: 't' }, 'acme/web', 'badsha')).rejects.toThrow('422');
  });

  it('listCommits caps per_page at 50 even when caller requests more', async () => {
    let capturedUrl = '';
    const fetchImpl = async (url: string) => {
      capturedUrl = url;
      return { ok: true, status: 200, text: async () => '', json: async () => [] };
    };
    const c = makeGithubClientForTest(fetchImpl as any);
    await c.listCommits({ mode: 'pat', token: 't' }, 'acme/web', { perPage: 200 });
    expect(capturedUrl).toContain('per_page=50');
  });
});

