'use client';

import { Modal } from './modal';
import type { SignalSection } from './signal-pills';

export type SignalReportEntry = { ok: boolean; error?: string };

/** Transient per-signal verification report shown after a Verify run. One row
 *  per signal: ✓ Available / ✗ Failed, with the raw probe error for failures.
 *  The report only exists in memory after a verify — it is not persisted. */
export function SignalReportModal({
  open,
  onClose,
  title = 'Verification report',
  sections,
  report,
  checkedAt,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  sections: SignalSection[];
  report: Record<string, SignalReportEntry> | null;
  checkedAt?: string | null;
}) {
  return (
    <Modal open={open && !!report} onClose={onClose} title={title}>
      {report && (
        <div className="flex flex-col gap-4">
          {checkedAt && (
            <p className="text-xs text-fg-faint">Checked {new Date(checkedAt).toLocaleString()}</p>
          )}
          <ul className="flex flex-col gap-3">
            {sections.map((s) => {
              const r = report[s.key];
              const ok = !!r?.ok;
              return (
                <li key={s.key} className="flex items-start gap-2.5">
                  <span aria-hidden className={ok ? 'text-ok' : 'text-crit'}>
                    {ok ? '✓' : '✗'}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-fg">{s.label}</span>
                      <span className={`text-xs font-medium ${ok ? 'text-ok' : 'text-crit'}`}>
                        {ok ? 'Available' : 'Failed'}
                      </span>
                    </div>
                    {!ok && r?.error && (
                      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-raised p-3 font-mono text-xs text-fg-muted">
                        {r.error}
                      </pre>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </Modal>
  );
}
