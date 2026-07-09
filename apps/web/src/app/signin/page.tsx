'use client';

import { useEffect, useState } from 'react';
import { Logo } from '../../components/ui/logo';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { passwordSignIn, startSso, completeSsoRedirect } from '../../lib/idp-auth';

type SsoInfo = { ssoEnabled: boolean; tenantId: string | null; providerId: string | null };
type AuthMethods = { password: boolean; oidc: boolean; sso: boolean; signup: boolean };

export default function SignInPage() {
  const [info, setInfo] = useState<(SsoInfo & AuthMethods) | null>(null);
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
        const [methodsRes, ssoRes] = await Promise.all([
          fetch('/auth/methods'),
          fetch('/auth/sso-info'),
        ]);
        const methods: AuthMethods = methodsRes.ok
          ? await methodsRes.json()
          : { password: true, oidc: false, sso: false, signup: false };
        const ssoInfo: SsoInfo = ssoRes.ok
          ? await ssoRes.json()
          : { ssoEnabled: false, tenantId: null, providerId: null };
        if (!active) return;
        setInfo({ ...methods, ...ssoInfo });
        if (methods.sso && ssoInfo.ssoEnabled && ssoInfo.tenantId) {
          const done = await completeSsoRedirect(ssoInfo.tenantId);
          if (done) { window.location.href = '/'; return; }
        }
      } catch {
        if (active) setInfo({ password: true, oidc: false, sso: false, signup: false, ssoEnabled: false, tenantId: null, providerId: null });
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

  const hasSecondary = info ? (info.oidc || (info.sso && info.ssoEnabled)) : false;

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
            {info.password && (
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
            )}

            {info.password && hasSecondary && (
              <div className="my-5 flex items-center gap-3 text-xs text-fg-faint">
                <span className="h-px flex-1 bg-edge" /> OR <span className="h-px flex-1 bg-edge" />
              </div>
            )}

            {info.oidc && (
              <Button type="button" variant="secondary" onClick={() => { window.location.href = '/auth/oidc/login'; }} className="w-full justify-center">
                Sign in with OIDC
              </Button>
            )}

            {info.sso && info.ssoEnabled && (
              <Button type="button" variant="secondary" disabled={busy} onClick={onSso} className="w-full justify-center">
                Single sign-on
              </Button>
            )}

            {error && <p className="mt-4 text-center text-sm text-crit">{error}</p>}

            {info.signup && (
              <p className="mt-4 text-center text-sm text-fg-muted">
                Don&apos;t have an account?{' '}
                <a href="/signup" className="font-medium underline hover:text-fg">Sign up</a>
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
