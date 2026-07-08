'use client';

import { useEffect, useState } from 'react';
import { fetchTeamForecast, type TeamForecast } from '../../lib/api';
import { Skeleton } from '../ui/skeleton';

type ForecastState =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'ready'; forecast: TeamForecast; showCostUsd: boolean };

const TIERS: { key: keyof TeamForecast; label: string }[] = [
  { key: 'basic', label: 'Basic (memory-assisted)' },
  { key: 'medium', label: 'Medium' },
  { key: 'large', label: 'Large (cold)' },
];

export function CostForecast({ slug }: { slug: string }) {
  const [state, setState] = useState<ForecastState>({ status: 'loading' });

  useEffect(() => {
    fetchTeamForecast(slug)
      .then(({ forecast, showCostUsd }) => {
        const totalTokens =
          Object.values(forecast).reduce(
            (sum, t) => sum + t.inputTokens + t.outputTokens,
            0,
          );
        if (totalTokens === 0) {
          setState({ status: 'hidden' });
        } else {
          setState({ status: 'ready', forecast, showCostUsd });
        }
      })
      .catch(() => {
        setState({ status: 'hidden' });
      });
  }, [slug]);

  if (state.status === 'loading') {
    return (
      <div className="rounded-card border border-edge bg-surface p-5">
        <Skeleton rows={3} />
      </div>
    );
  }

  if (state.status === 'hidden') return null;

  const { forecast, showCostUsd } = state;

  return (
    <div className="rounded-card border border-edge bg-surface p-5">
      <div className="mb-3 flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-fg">Estimated cost per incident</span>
        <span className="text-xs text-fg-faint">rough estimate based on team structure</span>
      </div>
      <div className="flex flex-col divide-y divide-edge">
        {TIERS.map(({ key, label }) => {
          const tier = forecast[key];
          const totalTokens = tier.inputTokens + tier.outputTokens;
          return (
            <div key={key} className="flex items-center justify-between py-2.5">
              <span className="text-sm text-fg-muted">{label}</span>
              <span className="font-mono text-sm text-fg">
                ~{totalTokens.toLocaleString()} tokens
                {showCostUsd && (
                  <span className="text-fg-muted"> · ~${tier.costUsd.toFixed(2)}</span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
