'use client';

import { Input, Field, Select } from '../ui/input';
import type { PagerDutyRegion } from '../../lib/api';

export function PagerDutyCredsForm({
  region, onRegionChange,
  apiToken, onApiTokenChange,
  editing,
}: {
  region: PagerDutyRegion; onRegionChange: (r: PagerDutyRegion) => void;
  apiToken: string; onApiTokenChange: (s: string) => void;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Region">
        <Select value={region} onChange={(e) => onRegionChange(e.target.value as PagerDutyRegion)}>
          <option value="us">US — app.pagerduty.com</option>
          <option value="eu">EU — app.eu.pagerduty.com</option>
        </Select>
      </Field>
      <Field label={editing ? 'API token (leave blank to keep current)' : 'API token'}>
        <Input
          className="font-mono"
          type="password"
          value={apiToken}
          placeholder={editing ? '••••••••' : 'pd_token_…'}
          onChange={(e) => onApiTokenChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
