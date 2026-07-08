'use client';

import { Input, Field } from '../ui/input';
import type { AzureMode } from '../../lib/api';

export function AzureCredsForm({
  mode, onModeChange,
  tenantId, onTenantIdChange,
  clientId, onClientIdChange,
  clientSecret, onClientSecretChange,
  defaultSubscriptionId, onDefaultSubscriptionIdChange,
  defaultWorkspaceId, onDefaultWorkspaceIdChange,
  federationSubject, editing,
}: {
  mode: AzureMode; onModeChange: (m: AzureMode) => void;
  tenantId: string; onTenantIdChange: (s: string) => void;
  clientId: string; onClientIdChange: (s: string) => void;
  clientSecret: string; onClientSecretChange: (s: string) => void;
  defaultSubscriptionId: string; onDefaultSubscriptionIdChange: (s: string) => void;
  defaultWorkspaceId: string; onDefaultWorkspaceIdChange: (s: string) => void;
  federationSubject?: string | null;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit gap-1 rounded-md border border-edge bg-raised p-0.5">
        {([['service_principal', 'Service principal (recommended)'], ['workload_identity', 'Workload identity']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => onModeChange(m)}
            className={`rounded px-3 py-1 text-sm transition-colors ${mode === m ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      <Field label="Directory (tenant) ID">
        <Input className="font-mono" value={tenantId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => onTenantIdChange(e.target.value)} />
      </Field>
      <Field label="Application (client) ID">
        <Input className="font-mono" value={clientId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => onClientIdChange(e.target.value)} />
      </Field>

      {mode === 'service_principal' ? (
        <Field label={editing ? 'Client secret (leave blank to keep current)' : 'Client secret'}>
          <Input className="font-mono" type="password" value={clientSecret} placeholder="••••••••" onChange={(e) => onClientSecretChange(e.target.value)} />
        </Field>
      ) : (
        <div className="flex flex-col gap-1 rounded-md border border-edge bg-raised px-4 py-3">
          <span className="text-xs text-fg-muted">Federation subject</span>
          {federationSubject ? (
            <span className="font-mono text-sm text-fg">{federationSubject}</span>
          ) : (
            <span className="text-sm text-fg-faint">Generated when you save — add it as the subject of a federated credential on your Entra app afterwards.</span>
          )}
        </div>
      )}

      <Field label="Default subscription ID (used to verify access)">
        <Input className="font-mono" value={defaultSubscriptionId} placeholder="00000000-0000-0000-0000-000000000000" onChange={(e) => onDefaultSubscriptionIdChange(e.target.value)} />
      </Field>
      <Field label="Default Log Analytics workspace ID (optional — enables logs/traces verify)">
        <Input className="font-mono" value={defaultWorkspaceId} placeholder="workspace GUID" onChange={(e) => onDefaultWorkspaceIdChange(e.target.value)} />
      </Field>
    </div>
  );
}
