// apps/web/src/components/conversation/thread-message.tsx
import type { Participant, ThreadEvent } from '../../lib/api';
import { ParticipantAvatar } from './participant-avatar';
import { ToolChip } from './tool-chip';
import { Markdown } from './markdown';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const roleLabel: Record<Participant['role'], string> = {
  human: 'you', assistant: 'assistant', 'sub-agent': 'sub-agent', system: 'system',
};

export function ThreadMessage({ participant, items }: { participant: Participant; items: ThreadEvent[] }) {
  const firstAt = items[0]?.at ?? new Date().toISOString();
  return (
    <div className="flex gap-3">
      <ParticipantAvatar name={participant.name} color={participant.color} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-fg">{participant.name}</span>
          <span className="rounded-full border border-edge px-1.5 py-px text-[10px] text-fg-muted">{roleLabel[participant.role]}</span>
          <span className="ml-auto text-[11px] text-fg-faint">{relativeTime(firstAt)}</span>
        </div>
        {items.map((e) =>
          e.kind === 'message' ? (
            <div key={e.id} className="rounded-xl border border-edge bg-surface px-3.5 py-2.5 text-fg">
              <Markdown content={e.text} />
            </div>
          ) : e.kind === 'tool' ? (
            <ToolChip key={e.id} tool={e} />
          ) : null,
        )}
      </div>
    </div>
  );
}
