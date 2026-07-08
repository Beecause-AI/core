'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Logo } from '../../components/ui/logo';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';

type Phase = 'idle' | 'loading' | 'expired';

/** Display-only peek at the invite token (slug/email) — the server re-verifies the signature. */
function tokenClaims(token: string): { slug?: string; email?: string } {
  try {
    const payload = token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const j = JSON.parse(atob(payload)) as { slug?: string; email?: string };
    return { slug: j.slug, email: j.email };
  } catch {
    return {};
  }
}

// Set-password step: the invite link proves email ownership; submitting joins
// the org via /api/auth/accept-invite and auto-logs-in.
function AcceptInvite({ token }: { token: string }) {
  const [password, setPassword] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const { slug, email } = tokenClaims(token);
  // Enabled only after hydration: a pre-hydration native submit would GET-navigate
  // to /accept-invite? and silently drop the token.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPhase('loading');
    setError('');
    try {
      const res = await fetch('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      if (res.ok) {
        const j = (await res.json()) as { redirect: string };
        window.location.href = j.redirect;
        return;
      }
      if (res.status === 400) {
        setPhase('expired');
        return;
      }
      setError(res.status === 429 ? 'Too many attempts — try again shortly.' : 'Something went wrong. Please try again.');
      setPhase('idle');
    } catch {
      setError('Something went wrong. Please try again.');
      setPhase('idle');
    }
  }

  if (phase === 'expired') return <Expired />;

  return (
    <>
      <h1 className="text-xl font-semibold tracking-tight">Join your team</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {email ? <><span className="text-fg">{email}</span> has been invited</> : 'You have been invited'}
        {slug ? <> to <span className="font-mono text-fg">{slug}</span></> : null}. Choose a password to join.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Field label="Password">
            <Input
              type="password"
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Choose a password"
              autoComplete="new-password"
              minLength={10}
            />
          </Field>
          <span className="text-xs text-fg-faint">
            At least 10 characters. If you already have an account in this workspace, you keep
            your existing password.
          </span>
        </div>

        <Button type="submit" disabled={!ready || phase === 'loading'} className="w-full justify-center">
          {phase === 'loading' ? 'Joining…' : 'Accept invitation'}
        </Button>
      </form>

      {error && <p className="mt-4 text-sm text-crit">{error}</p>}
    </>
  );
}

function Expired() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Logo variant="mark" className="size-10" />
      <h1 className="text-xl font-semibold tracking-tight">Invitation no longer valid</h1>
      <p className="max-w-sm text-sm text-fg-muted">
        This invitation has expired or was revoked. Ask an administrator of the
        organization to send you a new one.
      </p>
    </div>
  );
}

// Inner component reads searchParams — wrapped in Suspense for static export safety.
function AcceptInviteContent() {
  const params = useSearchParams();
  const token = params.get('token');
  if (!token) return <Expired />;
  return <AcceptInvite token={token} />;
}

function Fallback() {
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <Logo variant="mark" className="size-10" />
      <p className="text-sm text-fg-muted">Loading…</p>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
        <Suspense fallback={<Fallback />}>
          <AcceptInviteContent />
        </Suspense>
      </main>
    </div>
  );
}
