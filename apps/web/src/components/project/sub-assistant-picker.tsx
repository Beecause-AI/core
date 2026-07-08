'use client';

import type { Assistant } from '../../lib/api';

/** Lists sibling assistants (excluding self). Each toggles an `agent.<id>` entry in enabledTools. */
export function SubAssistantPicker({
  siblings, value, onChange,
}: {
  siblings: Assistant[];
  value: string[];
  onChange: (next: string[]) => void;
}) {
  const has = (id: string) => value.includes(`agent.${id}`);
  const toggle = (id: string) => {
    const n = `agent.${id}`;
    onChange(has(id) ? value.filter((x) => x !== n) : [...value, n]);
  };

  if (siblings.length === 0)
    return <p className="text-sm text-fg-faint">No other assistants in this project yet.</p>;

  return (
    <div className="flex flex-col gap-3">
      {siblings.length > 0 && (
        <div className="flex flex-col gap-1">
          {siblings.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded-lg border border-edge px-3 py-2 text-sm">
              <input type="checkbox" checked={has(s.id)} onChange={() => toggle(s.id)} />
              <span className="font-medium text-fg">{s.name}</span>
              <span className="ml-auto font-mono text-xs text-fg-faint">{s.model}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
