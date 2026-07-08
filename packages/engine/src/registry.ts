import type { ProviderContext } from './provider.js';

export type CredentialSource = 'platform' | 'byok';
export type CancellationMode = 'in-flight' | 'boundary-only';

export interface ModelEntry {
  model: string;
  provider: string;              // provider id ("google" | "anthropic" | "openai-compatible")
  baseUrl?: string;              // for openai-compatible / self-hosted OSS
  credentialSource: CredentialSource;
  cancellation: CancellationMode;
  capabilities: { tools: boolean; streaming: boolean };
  byokProvider?: string;         // provider to use when an org's BYOK key is active for this model
}

export class ModelRegistry {
  private readonly byModel = new Map<string, ModelEntry>();
  constructor(entries: ModelEntry[]) {
    for (const e of entries) this.byModel.set(e.model, e);
  }
  get(model: string): ModelEntry {
    const e = this.byModel.get(model);
    if (!e) throw new Error(`unknown model: ${model}`);
    return e;
  }
}

/** Breaker scope: platform models share one breaker; BYOK is isolated per org. */
export function breakerKeyFor(entry: ModelEntry, orgId: string): string {
  const scope = entry.credentialSource === 'byok' ? orgId : 'platform';
  return `${entry.provider}:${entry.model}:${scope}`;
}

/** Resolves the upstream API key for an entry + org. Implementations: platform key
 *  from config, or decrypt the org's BYOK key. Injected into the engine. */
export interface CredentialResolver {
  resolve(entry: ModelEntry, orgId: string): Promise<ProviderContext>;
}

/** Back-compat alias: the resolver returns exactly the provider's injected context.
 *  Kept exported so existing imports keep working without churn. */
export type ProviderContextResolved = ProviderContext;
