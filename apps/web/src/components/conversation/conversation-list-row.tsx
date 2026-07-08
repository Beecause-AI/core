import type { ConversationSummary } from '../../lib/api';
import { Badge } from '../ui/badge';

function relativeTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function statusTone(status: string): 'info' | 'crit' | 'ok' | 'neutral' {
  if (status === 'open' || status === 'investigating') return 'info';
  if (status === 'error') return 'crit';
  if (status === 'done') return 'ok';
  return 'neutral';
}

export function ConversationListRow({ slug, summary }: { slug: string; summary: ConversationSummary }) {
  return (
    <a href={`/p/${slug}/conversations/${summary.id}`} className="block no-underline">
      <div className="flex items-center gap-3 rounded-xl border border-edge bg-surface px-4 py-3 hover:border-edge-strong">
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold text-fg">{summary.title}</div>
          {summary.preview && <div className="truncate text-xs text-fg-faint">{summary.preview}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge status={statusTone(summary.status)}>{summary.status}</Badge>
          <span className="text-[11px] text-fg-faint">
            {summary.source} · {summary.agentCount} agent{summary.agentCount === 1 ? '' : 's'} · {relativeTime(summary.lastActivityAt)}
          </span>
        </div>
      </div>
    </a>
  );
}
