'use client';

import { Input, Field } from '../ui/input';

export function DynatraceCredsForm({
  environmentUrl, onEnvironmentUrlChange,
  apiToken, onApiTokenChange,
  editing,
}: {
  environmentUrl: string; onEnvironmentUrlChange: (s: string) => void;
  apiToken: string; onApiTokenChange: (s: string) => void;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Environment URL">
        <Input
          type="url"
          value={environmentUrl}
          placeholder="https://<env-id>.live.dynatrace.com"
          onChange={(e) => onEnvironmentUrlChange(e.target.value)}
        />
      </Field>
      <Field label={editing ? 'API token (leave blank to keep current)' : 'API token'}>
        <Input
          className="font-mono"
          type="password"
          value={apiToken}
          placeholder={editing ? '••••••••' : 'dt0c01.…'}
          onChange={(e) => onApiTokenChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
