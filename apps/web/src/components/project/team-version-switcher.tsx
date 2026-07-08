'use client';

import { useEffect, useState } from 'react';
import { fetchTeamVersions, activateTeamVersion, type TeamVersion } from '../../lib/api';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';

/**
 * Active-version selector + "generate new version" trigger. Selecting a different version
 * re-materializes the live team from that immutable snapshot (autogen agents are replaced;
 * manual agents kept), so we confirm when `modified` is true since edits will be lost.
 */
export function TeamVersionSwitcher({
  slug, modified, onActivated, onRedesign, canRedesign,
}: {
  slug: string;
  modified: boolean;
  onActivated: () => void;
  onRedesign: () => void;
  canRedesign: boolean;
}) {
  const [versions, setVersions] = useState<TeamVersion[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void fetchTeamVersions(slug).then((r) => setVersions(r.versions)).catch(() => setVersions([])); }, [slug]);

  const active = versions.find((v) => v.isActive) ?? null;

  async function activate(id: string) {
    if (id === active?.id) return;
    if (modified && !confirm('You have unsaved changes to this team. Switching versions will replace them. Continue?')) return;
    setBusy(true);
    try { await activateTeamVersion(slug, id); onActivated(); }
    finally { setBusy(false); }
  }

  return (
    <div className="flex items-center gap-2">
      {versions.length > 0 && (
        <label className="flex items-center gap-2 text-sm text-fg-muted">
          Version
          <select
            className="rounded-md border border-edge bg-surface px-2 py-1 text-sm text-fg"
            value={active?.id ?? ''}
            disabled={busy}
            onChange={(e) => void activate(e.target.value)}
          >
            {!active && <option value="">— none active —</option>}
            {versions.map((v) => (
              <option key={v.id} value={v.id}>
                Version {v.version ?? '?'}{v.isActive ? ' (active)' : ''} · {v.agentCount} agents
              </option>
            ))}
          </select>
        </label>
      )}
      {modified && <Badge status="warn">modified</Badge>}
      {canRedesign && <Button variant="secondary" disabled={busy} onClick={onRedesign}>Generate new version</Button>}
    </div>
  );
}
