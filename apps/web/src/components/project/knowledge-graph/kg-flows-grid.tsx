import type { KgFlow } from '../../../lib/api';
import { Button } from '../../ui/button';

export function KgFlowsGrid({
  flows,
  note,
  onRebuild,
  rebuilding,
  onOpenExplore,
}: {
  flows: KgFlow[];
  note: string | null;
  onRebuild: () => void;
  rebuilding: boolean;
  onOpenExplore: () => void;
}) {
  const partial = note != null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-medium text-fg">Business flows</h3>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={onOpenExplore}>Explore graph</Button>
          <Button variant="ghost" disabled={rebuilding} onClick={onRebuild}>
            {rebuilding ? 'Starting…' : 'Rebuild'}
          </Button>
        </div>
      </div>
      {partial && (
        <p className="rounded-md border border-edge bg-raised px-3 py-2 text-sm text-fg-muted">
          Structure mapped, but business flows aren&apos;t named yet. Rebuild to generate them.
        </p>
      )}
      {flows.length === 0 ? (
        <p className="text-sm text-fg-faint">No business flows yet.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {flows.map((f) => (
            <div key={f.id} className="rounded-card border border-edge bg-surface p-4">
              <span className="text-base font-medium text-fg">{f.name}</span>
              {f.digest && (
                <span className="mt-1 block text-sm text-fg-faint">{f.digest}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
