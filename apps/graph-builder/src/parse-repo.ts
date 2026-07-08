import type { RepoReader } from './repo-reader.js';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

export type ParsedNode = {
  tmpId: string;
  kind: 'file' | 'module';
  name: string;
  codeRefPath?: string;
};

export type ParsedEdge = {
  srcTmpId: string;
  dstTmpId: string;
  relation: 'contains' | 'imports';
};

export type ParsedGraph = {
  nodes: ParsedNode[];
  edges: ParsedEdge[];
};

// ---------------------------------------------------------------------------
// Import extraction by language / extension
// ---------------------------------------------------------------------------

/**
 * Extract raw import specifiers from file content, keyed by extension.
 * Returns the specifier strings as written in the source (not resolved).
 */
export function extractImports(ext: string, content: string): string[] {
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return extractJsImports(content);
    case '.py':
      return extractPyImports(content);
    case '.go':
      return extractGoImports(content);
    default:
      return [];
  }
}

// ES/TS: static import, side-effect import, require(), dynamic import()
const JS_IMPORT_RE =
  /(?:import\s+(?:type\s+)?(?:[^'";\n]+\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)(['"])((?:[^'"\\]|\\.)*)\1/g;

function extractJsImports(content: string): string[] {
  const specs: string[] = [];
  let m: RegExpExecArray | null;
  JS_IMPORT_RE.lastIndex = 0;
  while ((m = JS_IMPORT_RE.exec(content)) !== null) {
    if (m[2] !== undefined) specs.push(m[2]);
  }
  return specs;
}

// Python:
//   `from <pkg> import ...`  →  capture <pkg>
//   `import <pkg>`           →  capture <pkg>
// Relative:  from .foo import bar  →  '.foo'
//            from ..foo import bar →  '..foo'
function extractPyImports(content: string): string[] {
  const specs: string[] = [];
  // from <pkg> import …
  for (const m of content.matchAll(/^\s*from\s+(\.{0,2}[\w.]*)\s+import\s/gm)) {
    if (m[1]) specs.push(m[1]);
  }
  // import <pkg> (not preceded by 'from')
  for (const m of content.matchAll(/^\s*import\s+([\w.]+)/gm)) {
    if (m[1]) specs.push(m[1]);
  }
  return specs;
}

// Go: single-line or grouped imports
function extractGoImports(content: string): string[] {
  const specs: string[] = [];
  // grouped: import ( "a" "b" )
  const groupMatch = content.match(/import\s*\(([\s\S]*?)\)/);
  if (groupMatch?.[1]) {
    for (const m of groupMatch[1].matchAll(/"([^"]+)"/g)) {
      if (m[1] !== undefined) specs.push(m[1]);
    }
  }
  // single: import "a"
  for (const m of content.matchAll(/^import\s+"([^"]+)"/gm)) {
    if (m[1] !== undefined) specs.push(m[1]);
  }
  return specs;
}

// ---------------------------------------------------------------------------
// Import resolution
// ---------------------------------------------------------------------------

const JS_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PY_EXTS = ['.py'];
const GO_EXTS = ['.go'];

/**
 * Resolve an import specifier to a repo-relative path that exists in
 * knownPaths.  Returns null when the specifier is external / unresolvable.
 */
export function resolveImport(
  fromPath: string,
  spec: string,
  knownPaths: Set<string>,
): string | null {
  const ext = fileExt(fromPath);

  if (JS_EXTS.includes(ext)) {
    return resolveJsImport(fromPath, spec, knownPaths);
  }
  if (PY_EXTS.includes(ext)) {
    return resolvePyImport(fromPath, spec, knownPaths);
  }
  if (GO_EXTS.includes(ext)) {
    return resolveGoImport(spec, knownPaths);
  }
  return null;
}

function resolveJsImport(
  fromPath: string,
  spec: string,
  knownPaths: Set<string>,
): string | null {
  if (!spec.startsWith('.')) return null; // external package
  const base = dirOf(fromPath);
  const joined = joinPath(base, spec);
  // try exact, then with each extension, then /index.<ext>
  if (knownPaths.has(joined)) return joined;
  for (const e of JS_EXTS) {
    const candidate = joined + e;
    if (knownPaths.has(candidate)) return candidate;
  }
  for (const e of JS_EXTS) {
    const candidate = joined + '/index' + e;
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function resolvePyImport(
  fromPath: string,
  spec: string,
  knownPaths: Set<string>,
): string | null {
  const base = dirOf(fromPath);

  // Relative imports: spec starts with one or more dots
  if (spec.startsWith('.')) {
    // count leading dots = number of '..' levels (one dot = current dir)
    let dots = 0;
    while (spec[dots] === '.') dots++;
    const rest = spec.slice(dots); // remainder after dots

    // navigate up (dots-1) levels from current package dir
    let anchor = base;
    for (let i = 0; i < dots - 1; i++) {
      anchor = dirOf(anchor) || anchor;
    }

    const slashed = rest ? rest.replace(/\./g, '/') : '';
    const joined = slashed ? joinPath(anchor, slashed) : anchor;

    if (knownPaths.has(joined + '.py')) return joined + '.py';
    if (knownPaths.has(joined + '/__init__.py')) return joined + '/__init__.py';
    return null;
  }

  // Absolute dotted path — convert dots to slashes and try as a repo-relative path
  const slashed = spec.replace(/\./g, '/');
  if (knownPaths.has(slashed + '.py')) return slashed + '.py';
  if (knownPaths.has(slashed + '/__init__.py')) return slashed + '/__init__.py';

  // Also try from the same package: base/spec
  const fromBase = joinPath(base, slashed);
  if (knownPaths.has(fromBase + '.py')) return fromBase + '.py';

  return null;
}

function resolveGoImport(spec: string, knownPaths: Set<string>): string | null {
  // Only resolve if the spec (or the last path component) matches a known repo path
  if (knownPaths.has(spec + '.go')) return spec + '.go';
  // Try matching as a directory (would have index file, not typical in Go, but
  // for robustness check if the spec directly is a prefix of any known file)
  for (const p of knownPaths) {
    if (p === spec || p.startsWith(spec + '/')) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

function fileExt(path: string): string {
  const dot = path.lastIndexOf('.');
  const slash = path.lastIndexOf('/');
  if (dot > slash) return path.slice(dot);
  return '';
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/');
  if (slash === -1) return '';
  return path.slice(0, slash);
}

/** Naive POSIX-style path join + normalize (no fs module needed). */
function joinPath(base: string, rel: string): string {
  const parts = (base ? base + '/' + rel : rel).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') { out.pop(); }
    else if (p !== '.') { out.push(p); }
  }
  return out.join('/');
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * parseRepo — deterministic Pass A structural skeleton.
 *
 * Processes `reader.files` in sorted order and emits:
 *   - A `file` node per file
 *   - A `module` node per ancestor directory (deduped)
 *   - `contains` edges: parent-dir → child-dir and dir → file
 *   - `imports` edges for intra-repo relative specifiers (no duplicates)
 */
export async function parseRepo(
  reader: RepoReader,
  _repo: string,
): Promise<ParsedGraph> {
  // Sort files deterministically
  const sortedFiles = [...reader.files].sort((a, b) => a.path.localeCompare(b.path));

  const knownPaths = new Set(sortedFiles.map((f) => f.path));

  const nodes: ParsedNode[] = [];
  const nodeIndex = new Map<string, ParsedNode>(); // tmpId → node

  // Helper to get-or-create a module node for a directory path
  function ensureModuleNode(dirPath: string): ParsedNode {
    const tmpId = `dir:${dirPath}`;
    let node = nodeIndex.get(tmpId);
    if (!node) {
      node = { tmpId, kind: 'module', name: dirPath };
      nodes.push(node);
      nodeIndex.set(tmpId, node);
    }
    return node;
  }

  // --- Pass 1: build file nodes and module nodes + contains edges ----------
  const edges: ParsedEdge[] = [];
  const edgeSet = new Set<string>(); // serialised key for dedup

  function addEdge(edge: ParsedEdge): void {
    const key = `${edge.relation}:${edge.srcTmpId}→${edge.dstTmpId}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push(edge);
    }
  }

  for (const file of sortedFiles) {
    const { path } = file;
    const fileNode: ParsedNode = {
      tmpId: path,
      kind: 'file',
      name: path,
      codeRefPath: path,
    };
    nodes.push(fileNode);
    nodeIndex.set(path, fileNode);
  }

  // Build dir hierarchy and contains edges.
  // We need to process dirs before emitting edges to ensure module nodes exist.
  for (const file of sortedFiles) {
    const { path } = file;
    const segments = path.split('/');

    if (segments.length < 2) {
      // Root-level file — no contains edge per spec
      continue;
    }

    // Ensure all ancestor dirs exist and emit dir→dir contains edges
    for (let depth = 1; depth < segments.length; depth++) {
      const dirPath = segments.slice(0, depth).join('/');
      ensureModuleNode(dirPath);

      if (depth < segments.length - 1) {
        // dir → sub-dir
        const parentPath = depth > 1 ? segments.slice(0, depth - 1).join('/') : null;
        const childPath = dirPath;
        if (parentPath) {
          const parentTmpId = `dir:${parentPath}`;
          const childTmpId = `dir:${childPath}`;
          addEdge({ srcTmpId: parentTmpId, dstTmpId: childTmpId, relation: 'contains' });
        }
      } else {
        // deepest dir → file
        const immediateDirPath = segments.slice(0, depth).join('/');
        addEdge({ srcTmpId: `dir:${immediateDirPath}`, dstTmpId: path, relation: 'contains' });
      }
    }
  }

  // --- Pass 2: import edges --------------------------------------------------
  for (const file of sortedFiles) {
    const { path } = file;
    const ext = fileExt(path);
    const content = await reader.read(path);
    if (content === null) continue; // degrade: skip imports

    const specs = extractImports(ext, content);
    for (const spec of specs) {
      const resolved = resolveImport(path, spec, knownPaths);
      if (resolved === null) continue;
      addEdge({ srcTmpId: path, dstTmpId: resolved, relation: 'imports' });
    }
  }

  return { nodes, edges };
}
