export const PROJECT_TABS = ['overview', 'integrations', 'knowledge-graph', 'assistants', 'memory', 'skills', 'conversations', 'members', 'settings'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

/** Parse `/p/{slug}/{tab}/{sub}/{...rest}` → { slug, tab, sub, rest }. Unknown/missing tab → 'overview'. */
export function parseProjectPath(pathname: string): { slug: string | null; tab: ProjectTab; sub: string | null; rest: string[] } {
  const parts = pathname.replace(/^\/+|\/+$/g, '').split('/'); // ['p','{slug}','{tab}?','{sub}?', ...rest]
  const slug = parts[1] ?? null;
  const raw = parts[2];
  const tab = (PROJECT_TABS as readonly string[]).includes(raw ?? '') ? (raw as ProjectTab) : 'overview';
  const sub = parts[3] ?? null;
  const rest = parts.slice(4);
  return { slug: slug || null, tab, sub, rest };
}

/** Build a tab URL for a project. */
export function projectTabHref(slug: string, tab: ProjectTab): string {
  return tab === 'overview' ? `/p/${slug}` : `/p/${slug}/${tab}`;
}

/** Build an integration sub-view URL for a provider (e.g. 'github'). */
export function integrationProviderHref(slug: string, provider: string): string {
  return `/p/${slug}/integrations/${provider}`;
}
