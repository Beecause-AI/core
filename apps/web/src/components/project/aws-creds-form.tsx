'use client';

import { Input, Field, Select } from '../ui/input';
import type { AwsMode } from '../../lib/api';

const REGIONS = ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-central-1', 'ap-south-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1', 'ca-central-1'];

export function AwsCredsForm({
  mode, onModeChange,
  accessKeyId, onAccessKeyIdChange,
  secretAccessKey, onSecretAccessKeyChange,
  roleArn, onRoleArnChange,
  defaultRegion, onDefaultRegionChange,
  externalId, editing,
}: {
  mode: AwsMode; onModeChange: (m: AwsMode) => void;
  accessKeyId: string; onAccessKeyIdChange: (s: string) => void;
  secretAccessKey: string; onSecretAccessKeyChange: (s: string) => void;
  roleArn: string; onRoleArnChange: (s: string) => void;
  defaultRegion: string; onDefaultRegionChange: (s: string) => void;
  externalId?: string | null;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="inline-flex w-fit gap-1 rounded-md border border-edge bg-raised p-0.5">
        {([['assume_role', 'IAM role (recommended)'], ['access_key', 'Access key']] as const).map(([m, label]) => (
          <button key={m} type="button" onClick={() => onModeChange(m)}
            className={`rounded px-3 py-1 text-sm transition-colors ${mode === m ? 'bg-accent/10 text-accent' : 'text-fg-muted hover:text-fg'}`}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'assume_role' ? (
        <div className="flex flex-col gap-4">
          <Field label="Role ARN">
            <Input className="font-mono" value={roleArn} placeholder="arn:aws:iam::111122223333:role/beecause-readonly" onChange={(e) => onRoleArnChange(e.target.value)} />
          </Field>
          <div className="flex flex-col gap-1 rounded-md border border-edge bg-raised px-4 py-3">
            <span className="text-xs text-fg-muted">External ID</span>
            {externalId ? (
              <span className="font-mono text-sm text-fg">{externalId}</span>
            ) : (
              <span className="text-sm text-fg-faint">Generated when you save — add it to the role&apos;s trust policy afterwards.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Access key ID">
            <Input className="font-mono" value={accessKeyId} placeholder="AKIA…" onChange={(e) => onAccessKeyIdChange(e.target.value)} />
          </Field>
          <Field label={editing ? 'Secret access key (leave blank to keep current)' : 'Secret access key'}>
            <Input className="font-mono" type="password" value={secretAccessKey} placeholder="••••••••" onChange={(e) => onSecretAccessKeyChange(e.target.value)} />
          </Field>
        </div>
      )}

      <Field label="Default region">
        <Select value={defaultRegion} onChange={(e) => onDefaultRegionChange(e.target.value)}>
          {REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
      </Field>
    </div>
  );
}
