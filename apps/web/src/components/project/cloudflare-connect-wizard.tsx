'use client';

import { Input, Field } from '../ui/input';
import type { CloudflareMode, CloudflareSignal } from '../../lib/api';

export type CloudflareWizardResult =
  | { mode: 'api_token'; apiToken: string; kind: 'account' | 'zone'; accountId: string; zoneId?: string; name: string; signals: CloudflareSignal[] }
  | { mode: 'global_key'; email: string; apiKey: string; kind: 'account' | 'zone'; accountId: string; zoneId?: string; name: string; signals: CloudflareSignal[] };

export function CloudflareCredsForm({
  mode,
  onModeChange,
  apiToken,
  onApiTokenChange,
  email,
  onEmailChange,
  apiKey,
  onApiKeyChange,
  accountId,
  onAccountIdChange,
}: {
  mode: CloudflareMode;
  onModeChange: (m: CloudflareMode) => void;
  apiToken: string;
  onApiTokenChange: (s: string) => void;
  email: string;
  onEmailChange: (s: string) => void;
  apiKey: string;
  onApiKeyChange: (s: string) => void;
  accountId: string;
  onAccountIdChange: (s: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="inline-flex w-fit gap-1 rounded-md border border-edge bg-raised p-0.5">
        {([['api_token', 'API Token'], ['global_key', 'Global API Key']] as const).map(([m, label]) => (
          <button
            key={m}
            type="button"
            onClick={() => onModeChange(m)}
            className={`rounded px-3 py-1 text-sm transition-colors ${mode === m ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === 'api_token' ? (
        <Field label="API Token">
          <Input type="password" autoComplete="off" className="font-mono" value={apiToken} placeholder="Scoped read-only token" onChange={(e) => onApiTokenChange(e.target.value)} />
        </Field>
      ) : (
        <>
          <Field label="Account email">
            <Input value={email} placeholder="you@example.com" onChange={(e) => onEmailChange(e.target.value)} />
          </Field>
          <Field label="Global API Key">
            <Input type="password" autoComplete="off" className="font-mono" value={apiKey} placeholder="Legacy global API key" onChange={(e) => onApiKeyChange(e.target.value)} />
          </Field>
        </>
      )}
      <Field label={mode === 'api_token' ? 'Account ID (required)' : 'Account ID (optional)'}>
        <Input className="font-mono" value={accountId} placeholder="Shown on the API token page" onChange={(e) => onAccountIdChange(e.target.value)} />
      </Field>
    </div>
  );
}
