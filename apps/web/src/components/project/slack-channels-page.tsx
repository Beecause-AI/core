'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ProjectSlackChannels, type SlackChannelBinding } from '../../lib/api';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';

function channelLabel(b: SlackChannelBinding): string {
  return b.channelName ? `#${b.channelName}` : b.slackChannelId;
}

function mapMutationError(e: unknown): string {
  const err = e as { status?: number; message?: string };
  if (err?.status === 409 && err?.message?.includes('another project')) {
    return 'This channel is already assigned to another project — ask an org admin to reassign it.';
  }
  if (err?.status === 409 && err?.message?.includes('slack not connected')) {
    return 'Slack is not connected for this org. Ask an org admin to connect it under Admin → Slack.';
  }
  return err?.message ?? 'Something went wrong. Please try again.';
}

export function SlackChannelsPage({ slug, isAdmin }: { slug: string; isAdmin: boolean }) {
  const [data, setData] = useState<ProjectSlackChannels | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  // Add by ID
  const [newChannelId, setNewChannelId] = useState('');

  // Busy tracking
  const [busy, setBusy] = useState<string | null>(null); // channelId or 'new'

  const unmountedRef = useRef(false);
  useEffect(() => () => { unmountedRef.current = true; }, []);

  async function fetchAll() {
    try {
      const channels = await api<ProjectSlackChannels>(`/api/org/projects/${slug}/slack-channels`);
      if (unmountedRef.current) return;
      setData(channels);
    } catch (e) {
      if (unmountedRef.current) return;
      const err = e as { status?: number; message?: string };
      if (err?.status === 401) return;
      setError(err?.message ?? 'Failed to load Slack channels');
    } finally {
      if (!unmountedRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    void fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function handleUnassign(channelId: string) {
    if (!confirm('Unassign this channel from the project?')) return;
    setBusy(channelId); setError('');
    try {
      await api(`/api/org/projects/${slug}/slack-channels/${encodeURIComponent(channelId)}`, { method: 'DELETE' });
      await fetchAll();
    } catch (e) {
      setError(mapMutationError(e));
    } finally {
      if (!unmountedRef.current) setBusy(null);
    }
  }

  async function handleAssign(channelId: string) {
    setBusy(channelId); setError('');
    try {
      await api(`/api/org/projects/${slug}/slack-channels`, {
        method: 'POST',
        body: JSON.stringify({ channelId }),
      });
      await fetchAll();
    } catch (e) {
      setError(mapMutationError(e));
    } finally {
      if (!unmountedRef.current) setBusy(null);
    }
  }

  async function handleAddById() {
    const channelId = newChannelId.trim();
    if (!channelId) return;
    setBusy('new'); setError('');
    try {
      await api(`/api/org/projects/${slug}/slack-channels`, {
        method: 'POST',
        body: JSON.stringify({ channelId }),
      });
      setNewChannelId('');
      await fetchAll();
    } catch (e) {
      setError(mapMutationError(e));
    } finally {
      if (!unmountedRef.current) setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-fg">Slack channels</h2>

      {error && <p className="text-sm text-crit">{error}</p>}

      {loading ? (
        <Skeleton rows={4} />
      ) : !data?.connected ? (
        <div className="rounded-card border border-edge bg-surface px-5 py-4">
          <p className="text-sm text-fg-muted">
            Slack isn&apos;t connected for this org. Ask an org admin to connect it under{' '}
            <span className="font-medium text-fg">Admin → Slack</span>.
          </p>
        </div>
      ) : (
        <>
          {/* How to add a channel — admin only (assigning is admin-only) */}
          {isAdmin && (
            <div className="rounded-card border border-edge bg-surface px-5 py-4">
              <h3 className="text-sm font-semibold text-fg">Add a channel from Slack</h3>
              <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm text-fg-muted">
                <li>In the Slack channel, invite the bot — type <span className="font-mono text-fg">/invite @Beecause.AI</span> (or your own Slack app).</li>
                <li>Post a message that mentions <span className="font-mono text-fg">@Beecause.AI</span>.</li>
                <li>The channel then appears under <span className="font-medium text-fg">Available to claim</span> below — assign it to this project.</li>
              </ol>
              <p className="mt-2 text-xs text-fg-faint">
                Once assigned, mentions are handled automatically by the project’s incident response team — there’s no per-channel assistant to choose.
              </p>
              <p className="mt-1 text-xs text-fg-faint">
                Connected your own Slack app instead of the Beecause app? Invite and mention <span className="font-mono">that</span> app’s bot, not <span className="font-mono">@Beecause.AI</span>.
              </p>
              <p className="mt-1 text-xs text-fg-faint">Already know the channel ID? Add it directly under “Add by channel ID”.</p>
            </div>
          )}

          {/* Assigned channels */}
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Assigned to this project</h3>
            {data.assigned.length === 0 ? (
              <EmptyState title="No channels assigned to this project yet." body="" />
            ) : (
              <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                {data.assigned.map((b) => (
                  <div key={b.slackChannelId} className="flex items-center gap-2 px-5 py-3">
                    <div className="flex min-w-[8rem] flex-1 flex-col">
                      <span className="truncate font-mono text-sm text-fg">{channelLabel(b)}</span>
                      {b.channelName && <span className="truncate font-mono text-xs text-fg-faint">{b.slackChannelId}</span>}
                    </div>
                    {isAdmin && (
                      <Button
                        variant="danger"
                        disabled={busy === b.slackChannelId}
                        onClick={() => void handleUnassign(b.slackChannelId)}
                      >
                        Unassign
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Available channels — admin only */}
          {isAdmin && data.available.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Available to claim</h3>
              <div className="divide-y divide-edge rounded-card border border-edge bg-surface">
                {data.available.map((b) => (
                  <div key={b.slackChannelId} className="flex items-center gap-2 px-5 py-3">
                    <div className="flex min-w-[8rem] flex-1 flex-col">
                      <span className="truncate font-mono text-sm text-fg">{channelLabel(b)}</span>
                      {b.channelName && <span className="truncate font-mono text-xs text-fg-faint">{b.slackChannelId}</span>}
                    </div>
                    <Button
                      variant="secondary"
                      disabled={busy === b.slackChannelId}
                      onClick={() => void handleAssign(b.slackChannelId)}
                    >
                      {busy === b.slackChannelId ? 'Assigning…' : 'Assign to this project'}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Add by channel ID — admin only */}
          {isAdmin && (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold text-fg-muted uppercase tracking-wide">Add by channel ID</h3>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={newChannelId}
                  onChange={(e) => setNewChannelId(e.target.value)}
                  placeholder="Channel ID e.g. C0123ABCD"
                  className="w-56 font-mono"
                />
                <Button
                  disabled={busy === 'new' || !newChannelId.trim()}
                  onClick={() => void handleAddById()}
                >
                  {busy === 'new' ? 'Adding…' : 'Add'}
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
