'use client';

import { useEffect, useState } from 'react';
import { Logo } from '../../components/ui/logo';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { passwordSignIn, startSso, completeSsoRedirect } from '../../lib/idp-auth';

type SsoInfo = { ssoEnabled: boolean; tenantId: string | null; providerId: string | null };

export default function SignInPage() {
  const [info, setInfo] = useState<SsoInfo | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Prefill the email when the marketing login hands one off (?email=...).
  useEffect(() => {
    const hint = new URLSearchParams(window.location.search).get('email');
    if (hint) setEmail(hint);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/auth/sso-info');
        const i: SsoInfo = res.ok ? await res.json() : { ssoEnabled: false, tenantId: null, providerId: null };
        if (!active) return;
        setInfo(i);
        if (i.ssoEnabled && i.tenantId) {
          const done = await completeSsoRedirect(i.tenantId);
          if (done) { window.location.href = '/'; return; }
        }
      } catch {
        if (active) setInfo({ ssoEnabled: false, tenantId: null, providerId: null });
      }
    })();
    return () => { active = false; };
  }, []);

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await passwordSignIn(email, password);
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error && err.message === 'invalid' ? 'Incorrect email or password.' : 'Something went wrong. Please try again.');
      setBusy(false);
    }
  }

  async function onSso() {
    if (!info?.tenantId || !info.providerId) return;
    setBusy(true); setError('');
    try {
      await startSso(info.tenantId, info.providerId);
    } catch {
      setError('Could not start single sign-on. Please try again.');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo variant="mark" className="size-10" />
          <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
        </div>

        {info === null ? (
          <p className="text-center text-sm text-fg-muted">Loading…</p>
        ) : (
          <>
            <form onSubmit={onPassword} className="flex flex-col gap-4">
              <Field label="Email">
                <Input type="email" required autoFocus autoComplete="username"
                  value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
              </Field>
              <Field label="Password">
                <Input type="password" required autoComplete="current-password"
                  value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your password" />
              </Field>
              <Button type="submit" disabled={busy} className="w-full justify-center">
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
            </form>

            {info.ssoEnabled && (
              <>
                <div className="my-5 flex items-center gap-3 text-xs text-fg-faint">
                  <span className="h-px flex-1 bg-edge" /> OR <span className="h-px flex-1 bg-edge" />
                </div>
                <Button type="button" variant="secondary" disabled={busy} onClick={onSso} className="w-full justify-center">
                  Single sign-on
                </Button>
              </>
            )}

            {error && <p className="mt-4 text-center text-sm text-crit">{error}</p>}
          </>
        )}
      </main>
    </div>
  );
}
