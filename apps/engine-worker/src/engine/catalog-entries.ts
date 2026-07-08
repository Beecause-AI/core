import { CATALOG } from '@intellilabs/core';
import type { ModelEntry } from '@intellilabs/engine';

/** Per-model platform runtime config (provider + cancellation) for catalog models
 *  that are offered on the platform. Only platform-offered models get a platform entry. */
const VERTEX_GEMINI = { provider: 'google-vertex', byokProvider: 'google', cancellation: 'in-flight' as const };
// Claude on Vertex Model Garden (platform/workspace-billed); BYOK falls back to native Anthropic.
const VERTEX_CLAUDE = { provider: 'google-vertex-anthropic', byokProvider: 'anthropic', cancellation: 'in-flight' as const };
const PLATFORM_RUNTIME: Record<string, { provider: string; byokProvider?: string; cancellation: ModelEntry['cancellation'] }> = {
  'gemini-3.1-pro-preview': VERTEX_GEMINI,
  'gemini-3-flash-preview': VERTEX_GEMINI,
  'gemini-3.1-flash-lite-preview': VERTEX_GEMINI,
  'gemini-2.5-pro': VERTEX_GEMINI,
  'gemini-2.5-flash': VERTEX_GEMINI,
  'gemini-2.5-flash-lite': VERTEX_GEMINI,
  'claude-opus-4-8': VERTEX_CLAUDE,
  'claude-sonnet-4-6': VERTEX_CLAUDE,
  // Catalog id carries the date suffix; the provider's VERTEX_MODEL_ID map rewrites it to
  // the dateless Vertex publisher id (claude-haiku-4-5) for the URL.
  'claude-haiku-4-5-20251001': VERTEX_CLAUDE,
};

/** Catalog providers the engine actually has a ModelProvider for (no plain `openai`). */
const ENGINE_BYOK_PROVIDERS = new Set(['anthropic', 'google']);

/** One registry entry per catalog model. Platform-offered models with a PLATFORM_RUNTIME
 *  config get a platform entry; everything else gets a BYOK base entry on the first
 *  engine-supported catalog provider. Models whose only provider is unsupported (e.g.
 *  plain `openai`) are skipped — the registry would have no provider to run them. */
export function catalogModelEntries(): ModelEntry[] {
  return CATALOG.flatMap((m): ModelEntry[] => {
    const rt = m.providers.includes('platform') ? PLATFORM_RUNTIME[m.id] : undefined;
    if (rt) {
      return [{
        model: m.id,
        provider: rt.provider,
        credentialSource: 'platform' as const,
        cancellation: rt.cancellation,
        capabilities: m.capabilities,
        ...(rt.byokProvider ? { byokProvider: rt.byokProvider } : {}),
      }];
    }
    const byok = m.providers.find((p) => ENGINE_BYOK_PROVIDERS.has(p));
    if (!byok) return [];
    return [{
      model: m.id,
      provider: byok,
      credentialSource: 'byok' as const,
      cancellation: 'in-flight' as const,
      capabilities: m.capabilities,
      byokProvider: byok,
    }];
  });
}
