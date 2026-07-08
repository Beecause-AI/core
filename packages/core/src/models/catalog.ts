/** Single source of truth for the models the product knows about.
 *  The engine registry and the web model picker both derive from this list,
 *  so adding a model is a one-line change here. Pricing lives in
 *  packages/engine/src/cost.ts keyed by the same ids. */

export const PROVIDER_IDS = ['platform', 'anthropic', 'openai', 'google'] as const;
export type CatalogProvider = (typeof PROVIDER_IDS)[number];

export interface CatalogModel {
  id: string;
  displayName: string;
  /** Which providers offer this id. 'platform' = available to every org, billed to workspace. */
  providers: CatalogProvider[];
  capabilities: { tools: boolean; streaming: boolean };
}

export const CATALOG: CatalogModel[] = [
  // Platform — Gemini on Vertex AI (also reachable via a Google AI Studio BYOK key).
  // Tool-calling verified live on Vertex incl. the multi-turn round-trip (scripts/vertex-toolcall-smoke.mjs, 2026-06-16).
  { id: 'gemini-3.1-pro-preview', displayName: 'Gemini 3.1 Pro', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  { id: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  { id: 'gemini-3.1-flash-lite-preview', displayName: 'Gemini 3.1 Flash-Lite', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  { id: 'gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  { id: 'gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  { id: 'gemini-2.5-flash-lite', displayName: 'Gemini 2.5 Flash-Lite', providers: ['platform', 'google'], capabilities: { tools: true, streaming: true } },
  // Claude — platform via Vertex Model Garden (google-vertex-anthropic), with native Anthropic BYOK fallback.
  { id: 'claude-opus-4-8', displayName: 'Claude Opus 4.8', providers: ['platform', 'anthropic'], capabilities: { tools: true, streaming: true } },
  { id: 'claude-sonnet-4-6', displayName: 'Claude Sonnet 4.6', providers: ['platform', 'anthropic'], capabilities: { tools: true, streaming: true } },
  { id: 'claude-haiku-4-5-20251001', displayName: 'Claude Haiku 4.5', providers: ['platform', 'anthropic'], capabilities: { tools: true, streaming: true } },
];

const byId = new Map(CATALOG.map((m) => [m.id, m]));

export function catalogModel(id: string): CatalogModel | undefined {
  return byId.get(id);
}

export function catalogByProvider(provider: CatalogProvider): CatalogModel[] {
  return CATALOG.filter((m) => m.providers.includes(provider));
}

/** Other providers (besides `self`) that also offer `id`. Drives the "also on" hint. */
export function modelsAlsoOn(id: string, self: CatalogProvider): CatalogProvider[] {
  const m = byId.get(id);
  if (!m) return [];
  return m.providers.filter((p) => p !== self);
}
