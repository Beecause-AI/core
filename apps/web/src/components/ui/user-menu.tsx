'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type Me } from '../../lib/api';
import { Avatar } from './avatar';
import { cn } from './cn';

function signOut() {
  // RP-initiated logout: clears the session cookie and routes through Keycloak.
  window.location.href = '/auth/logout';
}

export function UserMenu() {
  const [me, setMe] = useState<Me | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Best-effort: a generic avatar still works (and Sign out) if /me fails.
    api<Me>('/api/me').then(setMe).catch(() => setMe(null));
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = me?.name ?? me?.email ?? 'Account';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-1.5 py-1 text-sm text-fg-muted transition-colors hover:bg-raised hover:text-fg"
      >
        <Avatar label={label} className="size-6" />
        <span className="max-w-40 truncate">{label}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1.5 w-56 overflow-hidden rounded-card border border-edge bg-raised py-1 shadow-xl shadow-black/40"
        >
          {(me?.name || me?.email) && (
            <div className="border-b border-edge px-3 py-2">
              {me?.name && <div className="truncate text-sm font-medium text-fg">{me.name}</div>}
              {me?.email && <div className="truncate text-xs text-fg-faint">{me.email}</div>}
            </div>
          )}
          <MenuLink href="/settings/profile">Profile</MenuLink>
          <MenuLink href="/settings/api-keys">API keys</MenuLink>
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="block w-full px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-edge hover:text-fg"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      role="menuitem"
      className={cn('block px-3 py-2 text-sm text-fg-muted transition-colors hover:bg-edge hover:text-fg')}
    >
      {children}
    </a>
  );
}
