export interface RepoClient {
  getRefInfo(creds: any, repo: string, ref: string | null): Promise<{ ref: string; sha: string }>;
  listTree(creds: any, repo: string, ref: string): Promise<{ truncated: boolean; entries: { path: string; type: string; sha: string; size?: number }[] }>;
  getFile(creds: any, repo: string, path: string, ref: string | null): Promise<{ text: string; sha: string }>;
}

export interface RepoReader {
  commitSha: string;
  truncated: boolean;
  files: { path: string; sha: string }[];
  read(path: string): Promise<string | null>;
}

const PARSEABLE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go']);
const PARSEABLE_NAMES = new Set(['Dockerfile']);

function isParseable(path: string): boolean {
  const parts = path.split('/');
  const filename = parts[parts.length - 1] ?? '';
  if (PARSEABLE_NAMES.has(filename)) return true;
  const dot = filename.lastIndexOf('.');
  if (dot === -1) return false;
  return PARSEABLE_EXTS.has(filename.slice(dot));
}

export interface MakeRepoReaderOptions {
  client: RepoClient;
  creds: any;
  repo: string;
  ref: string | null;
  maxFileBytes: number;
  maxFiles: number;
}

export async function makeRepoReader(opts: MakeRepoReaderOptions): Promise<RepoReader> {
  const { client, creds, repo, ref, maxFileBytes, maxFiles } = opts;

  const { sha } = await client.getRefInfo(creds, repo, ref);
  const tree = await client.listTree(creds, repo, sha);

  const candidates = tree.entries
    .filter((e) => e.type === 'blob' && isParseable(e.path) && (e.size === undefined || e.size <= maxFileBytes))
    .sort((a, b) => a.path.localeCompare(b.path));

  const truncated = tree.truncated || candidates.length > maxFiles;
  const files = candidates.slice(0, maxFiles);

  async function read(path: string): Promise<string | null> {
    try {
      const result = await client.getFile(creds, repo, path, sha);
      return result.text;
    } catch {
      return null;
    }
  }

  return {
    commitSha: sha,
    truncated,
    files: files.map((f) => ({ path: f.path, sha: f.sha })),
    read,
  };
}
