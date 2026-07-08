'use client';

import { Input, Field, Select } from '../ui/input';
import type { DatadogSite } from '../../lib/api';

export function DatadogCredsForm({
  site, onSiteChange,
  apiKey, onApiKeyChange,
  appKey, onAppKeyChange,
  editing,
}: {
  site: DatadogSite; onSiteChange: (s: DatadogSite) => void;
  apiKey: string; onApiKeyChange: (s: string) => void;
  appKey: string; onAppKeyChange: (s: string) => void;
  editing?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Field label="Site">
        <Select value={site} onChange={(e) => onSiteChange(e.target.value as DatadogSite)}>
          <option value="us1">US1 — datadoghq.com</option>
          <option value="us3">US3 — us3.datadoghq.com</option>
          <option value="us5">US5 — us5.datadoghq.com</option>
          <option value="eu">EU — datadoghq.eu</option>
          <option value="ap1">AP1 — ap1.datadoghq.com</option>
          <option value="us1-fed">US1-FED — ddog-gov.com</option>
        </Select>
      </Field>
      <Field label={editing ? 'API key (leave blank to keep current)' : 'API key'}>
        <Input
          className="font-mono"
          type="password"
          value={apiKey}
          placeholder={editing ? '••••••••' : 'dd_api_key_…'}
          onChange={(e) => onApiKeyChange(e.target.value)}
        />
      </Field>
      <Field label={editing ? 'Application key (leave blank to keep current)' : 'Application key'}>
        <Input
          className="font-mono"
          type="password"
          value={appKey}
          placeholder={editing ? '••••••••' : 'dd_app_key_…'}
          onChange={(e) => onAppKeyChange(e.target.value)}
        />
      </Field>
    </div>
  );
}
