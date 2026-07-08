'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type TeamsConnectContext } from '../../../lib/api';
import { Logo } from '../../../components/ui/logo';
import { Button } from '../../../components/ui/button';
import { EmptyState } from '../../../components/ui/empty-state';
import { Skeleton } from '../../../components/ui/skeleton';

type Phase = 'loading' | 'pick-project' | 'done' | 'error';

export default function TeamsConnectPage() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [ctx, setCtx] = useState<TeamsConnectContext | null>(null);
  const [error, setError] = useState('');
  const [project, setProject] = useState<{ slug: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const tenant = params.get('tenant') ?? '';
  const conversation = params.get('conversation') ?? '';
  const serviceUrl = params.get('serviceUrl') ?? '';

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/teams/connect-context?tenant=${encodeURIComponent(tenant)}&conversation=${encodeURIComponent(conversation)}`);
        if (res.status === 401) {
          // IdP login lands on the workspace root; the user re-opens this connect link after signing in.
          window.location.href = '/signin';
          return;
        }
        if (res.status === 403) { setError('This Microsoft Teams tenant is already connected to a different organisation. Contact your Beecause org owner.'); setPhase('error'); return; }
        if (!res.ok) { setError('Something went wrong loading this page.'); setPhase('error'); return; }
        setCtx((await res.json()) as TeamsConnectContext);
        setPhase('pick-project');
      } catch {
        setError('Something went wrong loading this page.'); setPhase('error');
      }
    })();
  }, [tenant, conversation]);

  async function connectProject(p: { slug: string; name: string }) {
    setProject(p);
    setBusy(true); setError('');
    try {
      await api(`/api/org/projects/${p.slug}/teams-channels`, {
        method: 'POST', body: JSON.stringify({ conversationId: conversation }),
      });
      setPhase('done');
    } catch (e) {
      const err = e as ApiError;
      setError(err?.status === 409
        ? 'This conversation is already connected to another project — an org owner or manager can move it.'
        : 'Could not connect the conversation. Please try again.');
    } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-6 bg-canvas px-6 py-16">
      <Logo />
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">Connect this Microsoft Teams conversation</h1>
        <p className="mt-1 text-sm text-fg-muted">
          Conversation <code className="rounded bg-raised px-1 py-0.5 font-mono text-xs text-fg">{conversation || '—'}</code>
          {ctx?.orgName ? <> · {ctx.orgName}</> : null}
        </p>
      </div>

      {phase === 'loading' && <Skeleton rows={3} />}

      {phase === 'error' && <EmptyState mark title="Can't connect this conversation" body={error} />}

      {phase === 'pick-project' && ctx && (
        ctx.projects.length === 0 ? (
          <EmptyState
            mark
            title="Nothing to connect"
            body={`You don't manage any projects in ${ctx.orgName}. Ask an owner or manager to connect this conversation.`}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-muted">Pick a project to connect this conversation to:</p>
            {ctx.projects.map((p) => (
              <button
                key={p.id}
                onClick={() => connectProject(p)}
                disabled={busy}
                className="rounded-card border border-edge bg-surface px-4 py-3 text-left text-sm font-medium text-fg transition-colors hover:border-edge-strong hover:bg-raised disabled:cursor-not-allowed disabled:opacity-60"
              >
                {p.name}
              </button>
            ))}
            <p className="mt-1 text-xs text-fg-faint">
              Replies are handled automatically by the project's incident response team — no per-conversation assistant to pick.
            </p>
            {error && <p className="text-sm text-crit">{error}</p>}
          </div>
        )
      )}

      {phase === 'done' && project && (
        <EmptyState
          mark
          title="Conversation connected 🎉"
          body={`This Teams conversation is now connected to ${project.name}. Head back to Microsoft Teams and mention the bot to start a conversation.`}
          action={<Button onClick={() => { window.location.href = `/p/${project.slug}`; }}>Open project in Beecause</Button>}
        />
      )}
    </main>
  );
}
