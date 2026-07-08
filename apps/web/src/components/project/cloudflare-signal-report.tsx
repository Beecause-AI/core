'use client';

import { useState } from 'react';
import type { CloudflareSignal, CloudflareSignalReport } from '../../lib/api';
import { Button } from '../ui/button';
import { Modal } from '../ui/modal';

const SIGNALS: CloudflareSignal[] = ['analytics', 'logs', 'workers'];

const SIGNAL_LABEL: Record<CloudflareSignal, string> = {
  analytics: 'Analytics (metrics)',
  logs: 'Logs (sampled)',
  workers: 'Workers Observability',
};

/** Turn a raw `Cloudflare <status>: <body>` error into a short, human summary.
 *  The full raw text is always preserved for the details modal. */
export function friendlyCloudflareError(raw: string): string {
  const status = /Cloudflare (\d{3})/.exec(raw)?.[1];
  // The probe appends an actionable "— grant <permission>" hint on 403s; surface it.
  const grant = /—\s*grant\s+(.+)$/i.exec(raw)?.[1]?.trim();
  if (status === '401' || status === '403') {
    return grant
      ? `Access denied — grant ${grant} to the token, then re-verify.`
      : 'Access denied — the token is missing a required read permission.';
  }
  if (status === '400') return 'Cloudflare rejected the request (400).';
  if (status === '429') return 'Rate limited by Cloudflare (429) — try again shortly.';
  if (status && status.startsWith('5')) return `Cloudflare service error (${status}).`;
  const firstLine = raw.split('\n')[0] ?? raw;
  return firstLine.length > 120 ? `${firstLine.slice(0, 120)}…` : firstLine;
}

/** Renders a per-signal verification report. Failed signals show a friendly
 *  one-line summary plus a "View details" button that opens the full raw error. */
export function CloudflareSignalReportView({ report }: { report: CloudflareSignalReport }) {
  const [detail, setDetail] = useState<CloudflareSignal | null>(null);

  return (
    <ul className="flex flex-col gap-1.5 text-sm">
      {SIGNALS.map((s) => {
        const r = report[s];
        return (
          <li key={s} className="flex items-start gap-2">
            <span className={r.ok ? 'text-ok' : 'text-crit'}>{r.ok ? '✓' : '✗'}</span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={r.ok ? 'text-fg' : 'text-fg'}>{SIGNAL_LABEL[s]}</span>
              {!r.ok && r.error && (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-fg-muted">{friendlyCloudflareError(r.error)}</span>
                  <Button
                    variant="ghost"
                    className="px-1.5 py-0.5 text-xs"
                    onClick={() => setDetail(s)}
                  >
                    View details
                  </Button>
                </span>
              )}
            </span>
          </li>
        );
      })}

      <Modal open={detail !== null} onClose={() => setDetail(null)} title={detail ? `${SIGNAL_LABEL[detail]} — error details` : ''}>
        {detail && (
          <div className="flex flex-col gap-3">
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-edge bg-raised p-3 font-mono text-xs text-fg-muted">
              {report[detail].error}
            </pre>
            <div className="flex justify-end">
              <Button
                variant="secondary"
                onClick={() => void navigator.clipboard?.writeText(report[detail].error ?? '')}
              >
                Copy
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </ul>
  );
}
