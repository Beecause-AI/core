// apps/web/src/components/conversation/handover-marker.tsx
import type { Participant } from '../../lib/api';
import { ParticipantAvatar } from './participant-avatar';
import { Markdown } from './markdown';

/** A handover rendered as a real chat message: the delegating agent assigning a task to a
 *  sub-agent. The task is the prompt the sub-agent received, shown as a normal message bubble
 *  (markdown), with a subtle accent in the target's colour. */
export function HandoverMessage({
  from,
  toName,
  toColor,
  task,
}: {
  from: Participant;
  toName: string;
  toColor: string;
  task: string | null;
}) {
  return (
    <div className="flex gap-3">
      <ParticipantAvatar name={from.name} color={from.color} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2">
          <span className="font-semibold text-fg">{from.name} → {toName}</span>
          <span
            className="rounded-full px-1.5 py-px text-[10px] font-medium"
            style={{ color: toColor, backgroundColor: `${toColor}1a` }}
          >
            delegated
          </span>
        </div>
        {task ? (
          <div
            className="rounded-xl border border-edge border-l-2 bg-surface px-3.5 py-2.5 text-fg"
            style={{ borderLeftColor: toColor }}
          >
            <Markdown content={task} />
          </div>
        ) : (
          <p className="text-sm italic text-fg-faint">handed off to {toName}</p>
        )}
      </div>
    </div>
  );
}

export function ReturnMarker({ fromName, toName }: { fromName: string; toName: string }) {
  return (
    <p className="my-1 text-center text-xs text-fg-faint">↩ {fromName} returned to {toName}</p>
  );
}
