import { catalogByProvider, catalogModel, modelsAlsoOn, MODEL_PRICES, type CatalogProvider } from '@intellilabs/core';

export type GroupProvider = CatalogProvider | 'openai-compatible';

export interface PickerModel {
  id: string;
  displayName: string;
  origin: 'curated' | 'live';
  capabilities: { tools: boolean; streaming: boolean };
  alsoOn?: GroupProvider[];
  pricing?: { inputPer1M: number; outputPer1M: number };
}
export interface ModelGroup {
  provider: GroupProvider;
  label: string;
  source: 'platform' | 'byok';
  models: PickerModel[];
  freeEntry?: boolean;
  custom?: { baseUrl: string };
}

type KeyRow = { provider: string; enabled: boolean; baseUrl: string | null };
type Args = { keys: KeyRow[]; live?: Partial<Record<string, string[]>> };

const LABELS: Record<GroupProvider, string> = {
  platform: 'Platform (included)',
  anthropic: 'Anthropic · your key',
  openai: 'OpenAI · your key',
  google: 'Google · your key',
  'openai-compatible': 'Custom (OpenAI-compatible)',
};

function curatedModels(provider: CatalogProvider, liveIds: string[] | undefined): PickerModel[] {
  const curated: PickerModel[] = catalogByProvider(provider).map((m) => ({
    id: m.id,
    displayName: m.displayName,
    origin: 'curated' as const,
    capabilities: m.capabilities,
    alsoOn: modelsAlsoOn(m.id, provider) as GroupProvider[],
    pricing: MODEL_PRICES[m.id],
  }));
  if (!liveIds?.length) return curated;
  const known = new Set(curated.map((m) => m.id));
  const extra: PickerModel[] = liveIds.filter((id) => !known.has(id)).map((id) => {
    const cat = catalogModel(id);
    return {
      id,
      displayName: cat?.displayName ?? id,
      origin: 'live' as const,
      capabilities: cat?.capabilities ?? { tools: false, streaming: true },
    };
  });
  return [...curated, ...extra];
}

/** Assemble the picker's provider-grouped model list for an org. */
export function buildModelGroups({ keys, live }: Args): ModelGroup[] {
  const groups: ModelGroup[] = [];

  groups.push({ provider: 'platform', label: LABELS.platform, source: 'platform', models: curatedModels('platform', live?.platform) });

  const enabled = new Map(keys.filter((k) => k.enabled).map((k) => [k.provider, k]));
  for (const p of ['anthropic', 'openai', 'google'] as const) {
    if (!enabled.has(p)) continue;
    groups.push({ provider: p, label: LABELS[p], source: 'byok', models: curatedModels(p, live?.[p]) });
  }

  const custom = enabled.get('openai-compatible');
  if (custom) {
    groups.push({
      provider: 'openai-compatible', label: LABELS['openai-compatible'], source: 'byok',
      models: (live?.['openai-compatible'] ?? []).map((id) => ({ id, displayName: id, origin: 'live' as const, capabilities: { tools: false, streaming: true } })),
      freeEntry: true, custom: { baseUrl: custom.baseUrl ?? '' },
    });
  }
  return groups;
}
