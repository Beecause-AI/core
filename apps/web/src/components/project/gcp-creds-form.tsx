'use client';

import { useRef, useState } from 'react';
import { Input, Field } from '../ui/input';
import { Button } from '../ui/button';
import { parseGcpSaKey } from '../../lib/gcp-key';
import type { GcpMode } from '../../lib/api';

/** One credential field: paste JSON, drag a .json file, or browse — no stacked alternatives.
 *  The native file input is fully hidden and opened via ref so there's never a stray
 *  "No file chosen" / unstyled control on the dark theme. */
function JsonDropzone({
  value,
  onText,
  placeholder,
}: {
  value: string;
  onText: (text: string) => void;
  placeholder: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState('');

  async function fromFile(f: File | undefined) {
    if (!f) return;
    setFileName(f.name);
    onText(await f.text());
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={async (e) => { e.preventDefault(); setDragging(false); await fromFile(e.dataTransfer.files?.[0]); }}
      className={`relative rounded-md border border-dashed transition-colors ${
        dragging ? 'border-accent bg-accent/5' : 'border-edge-strong bg-raised'
      }`}
    >
      <textarea
        value={value}
        spellCheck={false}
        placeholder={placeholder}
        onChange={(e) => { setFileName(''); onText(e.target.value); }}
        className="block h-36 w-full resize-none bg-transparent px-4 py-3 pr-28 font-mono text-sm text-fg outline-none placeholder:text-fg-faint"
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="absolute right-2 top-2 rounded-md border border-edge bg-surface px-2.5 py-1 text-xs text-fg-muted transition-colors hover:border-accent hover:text-fg"
      >
        Browse file
      </button>
      {fileName && (
        <span className="absolute bottom-2.5 right-3 max-w-[55%] truncate font-mono text-xs text-fg-faint">
          {fileName}
        </span>
      )}
      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={async (e) => { await fromFile(e.target.files?.[0]); }}
      />
    </div>
  );
}

export function GcpCredsForm({
  mode,
  onModeChange,
  saKey,
  onSaKeyChange,
  wifConfig,
  onWifConfigChange,
  defaultGcpProjectId,
  onDefaultGcpProjectIdChange,
  saEmail,
  onSaEmailChange,
  editing,
}: {
  mode: GcpMode;
  onModeChange: (m: GcpMode) => void;
  saKey: string;
  onSaKeyChange: (s: string) => void;
  wifConfig: string;
  onWifConfigChange: (s: string) => void;
  defaultGcpProjectId: string;
  onDefaultGcpProjectIdChange: (s: string) => void;
  saEmail: string | null;
  onSaEmailChange: (s: string | null) => void;
  /** In edit mode credentials may be left blank to keep the existing secret. */
  editing?: boolean;
}) {
  const parsed = mode === 'sa_key' && saKey.trim() ? parseGcpSaKey(saKey) : null;
  const parseError = parsed && !parsed.ok ? parsed.error : '';
  const keyLoaded = mode === 'sa_key' && !!saEmail && !parseError;

  function applySaText(text: string) {
    onSaKeyChange(text);
    const r = parseGcpSaKey(text);
    if (r.ok) {
      onSaEmailChange(r.clientEmail);
      // Prefill the default project ID from the key, but keep it editable.
      onDefaultGcpProjectIdChange(r.projectId);
    } else {
      onSaEmailChange(null);
    }
  }

  function clearSaKey() {
    onSaKeyChange('');
    onSaEmailChange(null);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit gap-1 rounded-md border border-edge bg-raised p-0.5">
        {([['sa_key', 'Service account key'], ['wif', 'Workload Identity']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded px-3 py-1 text-sm transition-colors ${
              mode === m ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'sa_key' ? (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Service account JSON key</span>
          {keyLoaded ? (
            <div className="flex items-center justify-between gap-3 rounded-md border border-edge-strong bg-raised px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="size-5 shrink-0 text-ok" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.5 5 5 10-11" />
                </svg>
                <div className="min-w-0">
                  <p className="text-sm text-fg">Service account key loaded</p>
                  <p className="truncate font-mono text-xs text-fg-faint">{saEmail}</p>
                </div>
              </div>
              <Button variant="ghost" type="button" onClick={clearSaKey}>Replace</Button>
            </div>
          ) : (
            <JsonDropzone
              value={saKey}
              onText={applySaText}
              placeholder={
                editing
                  ? 'Leave blank to keep the current key, or paste a new one / drag a .json file'
                  : 'Paste your service account JSON here — or drag a .json file onto this box'
              }
            />
          )}
          {parseError && <p className="text-sm text-crit">{parseError}</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm text-fg-muted">Workload Identity config (external_account JSON)</span>
          <JsonDropzone
            value={wifConfig}
            onText={onWifConfigChange}
            placeholder={
              editing
                ? 'Leave blank to keep the current config, or paste a new one / drag a .json file'
                : 'Paste your external_account JSON here — or drag a .json file onto this box'
            }
          />
        </div>
      )}

      <Field label="Default GCP project ID (required)">
        <Input
          className="font-mono"
          value={defaultGcpProjectId}
          placeholder="acme-prod"
          onChange={(e) => onDefaultGcpProjectIdChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
