'use client';

import { useState } from 'react';

/** Concise read-only setup steps for the GCP observability connection.
 *  Emphasises the reuse-everywhere path: grant ONE service account the read
 *  roles across every GCP project you want assistants to query, then connect it
 *  once at the org level — the project scope just picks which of those projects
 *  this project exposes. */
const ROLES: { role: string; why: string }[] = [
  { role: 'roles/monitoring.viewer', why: 'metrics (Cloud Monitoring / PromQL)' },
  { role: 'roles/logging.viewer', why: 'logs (Cloud Logging)' },
  { role: 'roles/cloudtrace.user', why: 'traces (Cloud Trace)' },
  { role: 'roles/errorreporting.viewer', why: 'errors (Cloud Error Reporting)' },
  { role: 'roles/browser', why: 'project discovery (lists projects in the picker)' },
];

export function GcpStepInstructions({
  title = 'Connect read-only Google Cloud access',
}: {
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-card border border-edge bg-surface p-5">
      <button
        type="button"
        className="flex items-center justify-between text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="text-sm font-semibold text-fg">{title}</span>
        <span className="text-xs text-fg-faint">{open ? 'Hide' : 'Show'} setup steps</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 pt-1 text-sm text-fg-muted">
          <p>
            Create <span className="text-fg">one</span> service account (or Workload Identity
            pool) and reuse it everywhere — you only connect it once at the org level. The project
            scope below just selects which of the projects it can reach this project exposes.
          </p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5">
            <li>
              Create a service account in any GCP project (e.g.{' '}
              <span className="font-mono text-fg-faint">beecause-observability</span>).
            </li>
            <li>
              Grant it these read-only roles on <span className="text-fg">each</span> GCP project
              you want assistants to query (run once per project, or set them at the folder /
              organization level to cover many at once):
              <ul className="mt-1 flex flex-col gap-0.5">
                {ROLES.map((r) => (
                  <li key={r.role}>
                    <span className="font-mono text-fg">{r.role}</span>{' '}
                    <span className="text-fg-faint">— {r.why}</span>
                  </li>
                ))}
              </ul>
            </li>
            <li>
              Download a JSON key (or configure Workload Identity Federation), then add it as a
              connection at{' '}
              <a href="/admin/gcp" className="text-accent hover:underline">
                the org level
              </a>
              .
            </li>
          </ol>
          <p className="text-xs text-fg-faint">
            Granting the roles on a folder or the organization once lets a single service account
            reach every project beneath it — no per-project grants needed.
          </p>
        </div>
      )}
    </div>
  );
}
