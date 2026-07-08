import { decryptSecret, getEnabledKeyCiphertext, type Db } from '@intellilabs/core';
import { vertexBaseUrl, type CredentialResolver, type ModelEntry, type ProviderContext } from '@intellilabs/engine';

export { vertexBaseUrl };

export interface VertexOpts {
  project: string;
  location: string;                       // 'global' | regional, e.g. 'europe-west1'
  getAccessToken: () => Promise<string>;  // ADC token fetcher (injected; real in prod)
}
export interface PlatformResolverOpts {
  geminiApiKey?: string;                  // Developer-API/BYOK fallback (not the default)
  vertex?: VertexOpts;
  byok?: { db: Db; secretsKey: Buffer };   // present once SECRETS_KEY is configured
}

/** Platform-credential resolver. The default platform Gemini goes through Vertex
 *  (ADC token, no API key). `google` (Developer API) is retained for BYOK; `byok` is a
 *  permanent failure until B2. */
export function makePlatformResolver(opts: PlatformResolverOpts): CredentialResolver {
  return {
    async resolve(entry: ModelEntry, orgId: string): Promise<ProviderContext> {
      if (entry.credentialSource === 'byok') {
        if (!opts.byok) throw new Error('byok credential resolution not configured');
        const ciphertext = await getEnabledKeyCiphertext(opts.byok.db, orgId, entry.provider);
        if (!ciphertext) throw new Error(`no enabled BYOK key for ${entry.provider}`);
        return { apiKey: decryptSecret(ciphertext, opts.byok.secretsKey) };
      }
      if (entry.provider === 'google-vertex') {
        if (!opts.vertex) throw new Error('vertex not configured for platform google-vertex');
        return { apiKey: await opts.vertex.getAccessToken(), baseUrl: vertexBaseUrl(opts.vertex.project, opts.vertex.location) };
      }
      if (entry.provider === 'google-vertex-anthropic') {
        // Claude on Model Garden: same ADC token + Vertex base as Gemini, but the
        // `anthropic` publisher segment (vs `google`).
        if (!opts.vertex) throw new Error('vertex not configured for platform google-vertex-anthropic');
        return { apiKey: await opts.vertex.getAccessToken(), baseUrl: vertexBaseUrl(opts.vertex.project, opts.vertex.location, 'anthropic') };
      }
      if (entry.provider === 'google') {
        if (!opts.geminiApiKey) throw new Error('no platform key configured for google');
        return { apiKey: opts.geminiApiKey, baseUrl: entry.baseUrl };
      }
      throw new Error(`no platform key configured for provider ${entry.provider}`);
    },
  };
}
