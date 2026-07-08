'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type Project } from '../../lib/api';

/** The active project slug from /p/{slug}/…, or null off project pages. */
function activeSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const parts = window.location.pathname.replace(/^\/+/, '').split('/');
  return parts[0] === 'p' ? (parts[1] ?? null) : null;
}

/** Top-bar project switcher. Shown ONLY when a project is active; lists the other
 *  projects to jump to. No "All projects" entry — the brand logo goes home. */
export function ProjectSwitcher() {
  const [slug, setSlug] = useState<string | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = activeSlug();
    setSlug(s);
    if (s) api<Project[]>('/api/org/projects').then(setProjects).catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (!slug) return null;
  const current = projects.find((p) => p.slug === slug);
  const others = projects.filter((p) => p.slug !== slug);

  return (
    <div ref={ref} className="flex items-center gap-3">
      <span className="text-fg-faint">/</span>
      <div className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-sm font-medium text-fg transition-colors hover:bg-raised"
        >
          {current?.name ?? slug}
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" className="size-4 text-fg-faint">
            <path d="m6 8 4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {open && (
          <div role="menu" className="absolute left-0 top-full mt-1.5 w-56 overflow-hidden rounded-card border border-edge bg-raised py-1 shadow-xl shadow-black/40">
            {others.length === 0 ? (
              <div className="px-3 py-2 text-sm text-fg-faint">No other projects</div>
            ) : others.map((p) => (
              <a
                key={p.slug}
                href={`/p/${p.slug}`}
                role="menuitem"
                className="block px-3 py-2 text-sm text-fg-muted no-underline transition-colors hover:bg-edge hover:text-fg"
              >
                {p.name}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
