import type { ReactNode } from 'react';
import { INTEGRATIONS, type IntegrationId } from '../../lib/integrations';
import { INTEGRATION_CONTENT } from '../../lib/integration-content';
import { IntegrationMark } from './integration-mark';

/** Branded empty-state / onboarding hero for an integration that isn't connected yet.
 *  Presentational only — the caller supplies the connect action (button, create form,
 *  method picker, or an info line) via `children`. */
export function IntegrationHero({ provider, children }: { provider: IntegrationId; children?: ReactNode }) {
  const name = INTEGRATIONS.find((i) => i.id === provider)?.name ?? provider;
  const content = INTEGRATION_CONTENT[provider];
  return (
    <div className="flex flex-col items-center gap-6 rounded-card border border-edge bg-surface px-6 py-10 text-center">
      <IntegrationMark provider={provider} size="lg" tone="hero" />
      <div className="flex flex-col gap-2">
        <h3 className="text-xl font-semibold tracking-tight text-fg">Connect {name}</h3>
        <p className="max-w-md text-sm text-fg-muted">{content.valueProp}</p>
      </div>
      <ul className="grid w-full max-w-2xl gap-2 sm:grid-cols-3">
        {content.bullets.map((b) => (
          <li key={b} className="flex items-start gap-2 rounded-card border border-edge bg-raised px-3 py-2 text-left text-sm text-fg-muted">
            <span aria-hidden className="text-accent">✦</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>
      {children && <div className="w-full">{children}</div>}
    </div>
  );
}
