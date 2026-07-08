// apps/web/src/components/conversation/conversation-thread.tsx
'use client';

import { useEffect, useState } from 'react';
import { api, type ConversationThread as Thread, type Participant, type ThreadEvent } from '../../lib/api';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../ui/empty-state';
import { Badge } from '../ui/badge';
import { ThreadMessage } from './thread-message';
import { HandoverMessage, ReturnMarker } from './handover-marker';

function statusTone(status: string): 'info' | 'crit' | 'ok' | 'neutral' {
  if (status === 'open' || status === 'investigating' || status === 'running') return 'info';
  if (status === 'error') return 'crit';
  if (status === 'done') return 'ok';
  return 'neutral';
}

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatCost(costUsd: string): string {
  const n = Number(costUsd);
  return n.toFixed(n >= 1 ? 2 : 4);
}

type Block =
  | { type: 'turn'; key: string; participant: Participant; items: ThreadEvent[] }
  | { type: 'handover'; key: string; event: Extract<ThreadEvent, { kind: 'handover' }> }
  | { type: 'return'; key: string; event: Extract<ThreadEvent, { kind: 'return' }> };

function groupEvents(events: ThreadEvent[], byKey: Map<string, Participant>): Block[] {
  const blocks: Block[] = [];
  let open: Extract<Block, { type: 'turn' }> | null = null;
  for (const e of events) {
    if (e.kind === 'message' || e.kind === 'tool') {
      if (!open || open.participant.key !== e.participantKey) {
        const participant: Participant = byKey.get(e.participantKey) ?? { key: e.participantKey, name: 'assistant', role: 'assistant', color: '#64748b' };
        open = { type: 'turn', key: e.id, participant, items: [] };
        // push the empty turn now; later same-participant events append into open.items via this shared reference
        blocks.push(open);
      }
      open.items.push(e);
    } else {
      open = null;
      blocks.push(e.kind === 'handover' ? { type: 'handover', key: e.id, event: e } : { type: 'return', key: e.id, event: e });
    }
  }
  return blocks;
}

export function ConversationThread({ slug, conversationId }: { slug: string; conversationId: string }) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true); setError(''); setThread(null);
    api<Thread>(`/api/org/projects/${slug}/conversations/${conversationId}`)
      .then(setThread)
      .catch((e: { status?: number; message?: string }) => { if (e?.status !== 401) setError(e?.message ?? 'Failed to load conversation'); })
      .finally(() => setLoading(false));
  }, [slug, conversationId]);

  if (loading) return <Skeleton rows={4} variant="list" />;
  if (error) return <p className="text-sm text-crit">{error}</p>;
  if (!thread || thread.events.length === 0) return <EmptyState title="No messages yet" body="This conversation has no activity recorded." />;

  const byKey = new Map(thread.participants.map((p) => [p.key, p] as const));
  const nameOf = (key: string) => byKey.get(key)?.name ?? 'assistant';
  const blocks = groupEvents(thread.events, byKey);
  const totalTokens = thread.totals.inputTokens + thread.totals.outputTokens;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between border-b border-edge pb-2.5 text-xs text-fg-muted">
        <Badge status={statusTone(thread.status)}>{thread.status}</Badge>
        <div className="flex items-center gap-1.5 tabular-nums">
          <span>{compact(totalTokens)} tokens</span>
          {thread.totals.costUsd != null && (
            <>
              <span className="text-fg-faint">·</span>
              <span>${formatCost(thread.totals.costUsd)}</span>
            </>
          )}
        </div>
      </div>
      {blocks.map((b) =>
        b.type === 'turn' ? (
          <ThreadMessage key={b.key} participant={b.participant} items={b.items} />
        ) : b.type === 'handover' ? (
          <HandoverMessage
            key={b.key}
            from={byKey.get(b.event.fromKey) ?? { key: b.event.fromKey, name: nameOf(b.event.fromKey), role: 'assistant', color: '#64748b' }}
            toName={b.event.toName}
            toColor={byKey.get(b.event.toKey)?.color ?? '#a855f7'}
            task={b.event.task}
          />
        ) : (
          <ReturnMarker key={b.key} fromName={nameOf(b.event.fromKey)} toName={nameOf(b.event.toKey)} />
        ),
      )}
    </div>
  );
}
