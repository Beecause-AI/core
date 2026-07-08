'use client';

import { useEffect, useState } from 'react';
import { currentSlug } from '../lib/org';
import { Button } from './ui/button';
import { Logo } from './ui/logo';

type Segment = { text: string; className?: string };
type Line = Segment[];

const NBSP = ' ';

/** Apex (org-agnostic) URL for the current location: strips the org label,
 *  keeps protocol + port so it works on dev hosts too. */
function apexUrl(loc: Location): string {
  const slug = currentSlug(loc.hostname);
  const apexHost = slug === null ? loc.host : loc.host.slice(slug.length + 1);
  return `${loc.protocol}//${apexHost}/`;
}

function workspaceLines(host: string, apexHost: string): Line[] {
  return [
    [
      { text: '→ ', className: 'text-accent' },
      { text: 'resolve workspace ', className: 'text-fg-muted' },
      { text: host, className: 'text-fg' },
    ],
    [{ text: `${NBSP}${NBSP}querying registry…`, className: 'text-fg-faint' }],
    [
      { text: '✗ HTTP 404', className: 'text-crit' },
      { text: " — workspace not found (or you don't have access)", className: 'text-fg-muted' },
    ],
    [
      { text: '→ ', className: 'text-accent' },
      { text: 'try: ', className: 'text-fg-muted' },
      { text: apexHost, className: 'text-fg' },
      { text: `${NBSP}${NBSP}# pick a workspace`, className: 'text-fg-faint' },
    ],
  ];
}

function pageLines(path: string): Line[] {
  return [
    [
      { text: '→ ', className: 'text-accent' },
      { text: 'GET ', className: 'text-fg-muted' },
      { text: path, className: 'text-fg' },
    ],
    [{ text: `${NBSP}${NBSP}searching routes…`, className: 'text-fg-faint' }],
    [
      { text: '✗ HTTP 404', className: 'text-crit' },
      { text: ' — page not found', className: 'text-fg-muted' },
    ],
    [
      { text: '→ ', className: 'text-accent' },
      { text: 'try: ', className: 'text-fg-muted' },
      { text: '/', className: 'text-fg' },
      { text: `${NBSP}${NBSP}# back to safety`, className: 'text-fg-faint' },
    ],
  ];
}

const lineChars = (line: Line) => line.reduce((n, s) => n + s.text.length, 0);

/** Full-screen terminal-trace 404. `workspace`: the org host resolves to
 *  nothing (or the user isn't a member — the API deliberately doesn't say
 *  which). `page`: the path doesn't exist. */
export function NotFound404({ variant }: { variant: 'workspace' | 'page' }) {
  // Location is read after mount: the static export prerenders without a DOM,
  // and baking a build-time host/path into the HTML would hydrate mismatched.
  const [loc, setLoc] = useState<Location | null>(null);
  useEffect(() => setLoc(window.location), []);

  const homeHref = loc === null ? '/' : variant === 'workspace' ? apexUrl(loc) : '/';
  const lines =
    loc === null
      ? []
      : variant === 'workspace'
        ? workspaceLines(loc.host, new URL(homeHref).host)
        : pageLines(loc.pathname);

  // Stagger: each line starts when the previous one finishes typing (+ a beat).
  const delays = lines.reduce<number[]>(
    (acc, line, i) => [...acc, i === 0 ? 0 : acc[i - 1]! + lineChars(lines[i - 1]!) * 30 + 250],
    [],
  );

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="px-6 py-4">
        <a href={homeHref} aria-label="Beecause home">
          <Logo variant="full" />
        </a>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 pb-24">
        <div className="w-full max-w-xl rounded-card border border-edge bg-surface shadow-2xl shadow-black/40">
          <div className="flex items-center gap-1.5 rounded-t-card border-b border-edge bg-raised px-4 py-2.5">
            <span className="size-2 rounded-full bg-edge-strong" />
            <span className="size-2 rounded-full bg-edge-strong" />
            <span className="size-2 rounded-full bg-edge-strong" />
          </div>
          <div className="p-5 font-mono text-sm leading-7" aria-hidden={loc === null}>
            {lines.map((line, i) => (
              <span
                key={i}
                className="type-line"
                style={{ '--ch': lineChars(line), '--at': `${delays[i]}ms` } as React.CSSProperties}
              >
                {line.map((seg, j) => (
                  <span key={j} className={seg.className}>
                    {seg.text}
                  </span>
                ))}
                {i === lines.length - 1 && <span className="type-cursor" aria-hidden />}
              </span>
            ))}
          </div>
        </div>

        <p className="text-sm text-fg-muted">
          {variant === 'workspace'
            ? "This workspace doesn't exist — or you don't have access to it."
            : "This page doesn't exist."}
        </p>

        <a href={homeHref} className="no-underline">
          <Button type="button">
            {variant === 'workspace' ? 'Go to your workspaces' : 'Back to home'}
          </Button>
        </a>
      </main>
    </div>
  );
}
