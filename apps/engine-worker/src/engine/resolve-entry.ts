import type { Db } from '@intellilabs/core';
import { hasEnabledModelKey } from '@intellilabs/core';
import type { ModelEntry, ModelRegistry } from '@intellilabs/engine';

type HasEnabledKey = (db: Db, orgId: string, provider: string) => Promise<boolean>;

/** Org-aware entry resolution. An explicit `provider` from the assistant wins:
 *  'platform' forces the platform entry; a byok provider forces that key (when enabled).
 *  When `provider` is undefined, fall back to the prior behaviour: use BYOK if the
 *  entry declares a byokProvider AND the org has an enabled key for it. */
export function makeResolveEntry(registry: ModelRegistry, db: Db, byokEnabled: boolean, hasEnabledKey: HasEnabledKey = hasEnabledModelKey) {
  return async (model: string, orgId: string, provider?: string | null): Promise<ModelEntry> => {
    let entry: ModelEntry;
    try {
      entry = registry.get(model);
    } catch (err) {
      if (provider && provider !== 'platform') {
        // A live/custom model id the registry doesn't know, but the assistant pinned a
        // concrete byok provider for it (e.g. an openai-compatible endpoint). Run it there.
        return { model, provider, credentialSource: 'byok', cancellation: 'in-flight', capabilities: { tools: false, streaming: true }, byokProvider: provider };
      }
      throw err;
    }

    if (provider === 'platform') return entry;

    if (provider && provider !== 'platform') {
      if (byokEnabled && (await hasEnabledKey(db, orgId, provider))) {
        return { ...entry, provider, credentialSource: 'byok' };
      }
      return entry; // requested byok provider unavailable → graceful platform fallback
    }

    // provider omitted → legacy behaviour
    if (byokEnabled && entry.byokProvider && (await hasEnabledKey(db, orgId, entry.byokProvider))) {
      return { ...entry, provider: entry.byokProvider, credentialSource: 'byok' };
    }
    return entry;
  };
}
