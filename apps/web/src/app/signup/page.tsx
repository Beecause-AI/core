'use client';

import { useState } from 'react';
import { Logo } from '../../components/ui/logo';
import { Button } from '../../components/ui/button';
import { Field, Input } from '../../components/ui/input';
import { registerLocal } from '../../lib/idp-auth';

export default function SignUpPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await registerLocal(email, password, name || undefined);
      window.location.href = '/';
    } catch (err) {
      if (err instanceof Error) {
        if (err.message === 'disabled') setError('Signup is disabled.');
        else if (err.message === 'conflict') setError('That email is already registered.');
        else setError('Something went wrong. Please try again.');
      } else {
        setError('Something went wrong. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      <main className="mx-auto flex min-h-[80vh] max-w-md flex-col justify-center px-6 py-16">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo variant="mark" className="size-10" />
          <h1 className="text-xl font-semibold tracking-tight">Create an account</h1>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field label="Name">
            <Input type="text" autoFocus autoComplete="name"
              value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name (optional)" />
          </Field>
          <Field label="Email">
            <Input type="email" required autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          <Field label="Password">
            <Input type="password" required minLength={8} autoComplete="new-password"
              value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" />
          </Field>
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        {error && <p className="mt-4 text-center text-sm text-crit">{error}</p>}

        <p className="mt-6 text-center text-sm text-fg-muted">
          Already have an account?{' '}
          <a href="/signin" className="font-medium underline hover:text-fg">Sign in</a>
        </p>
      </main>
    </div>
  );
}
