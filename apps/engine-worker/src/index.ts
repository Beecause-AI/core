import { PubSub } from '@google-cloud/pubsub';
import { GoogleAuth } from 'google-auth-library';
import { createStore, keyFromBase64, startTracing, getTracer, makeLogger } from '@intellilabs/core';
import { loadConfig } from './config.js';
import { buildWorkerApp } from './app.js';
import { buildEngineDeps, type EngineRuntime } from './engine/bootstrap.js';
import { makeGatewayClient } from './engine/mcp-gateway-client.js';
import { makeIntegrationToolsClient } from './engine/integration-tools-client.js';
import { pubsubDispatcher, type OrderedTopic } from './engine/pubsub-dispatcher.js';
import { makePubsubVerifier } from './auth/pubsub-oidc.js';
import { makeTurnTrace } from './engine/turn-trace.js';
import { catalogModelEntries } from './engine/catalog-entries.js';

startTracing('engine-worker');
const logger = makeLogger({ service: 'engine-worker', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

try {
  const cfg = loadConfig();
  const store = createStore({
    backend: cfg.STORE_BACKEND,
    databaseUrl: cfg.DATABASE_URL,
    vectorBackend: cfg.VECTOR_BACKEND === 'pgvector' ? 'pgvector'
      : cfg.VECTOR_BACKEND === 'inmemory' ? 'inmemory'
      : undefined,
    vectorDim: cfg.VECTOR_DIM,
    projectId: cfg.GCP_PROJECT_ID,
    emulatorHost: cfg.FIRESTORE_EMULATOR_HOST,
    firestoreVector: cfg.VECTOR_BACKEND === 'firestore',
    vector: {
      location: cfg.VECTOR_LOCATION,
      indexId: cfg.VECTOR_INDEX_ID,
      indexEndpointId: cfg.VECTOR_INDEX_ENDPOINT_ID,
      deployedIndexId: cfg.VECTOR_DEPLOYED_INDEX_ID,
    },
  });
  const db = store.db;
  const enabled = !!(cfg.PUBSUB_TOPIC && cfg.PUBSUB_PUSH_AUDIENCE && cfg.PUBSUB_PUSH_SA_EMAIL);

  let mcpGatewayClient: ReturnType<typeof makeGatewayClient> | undefined;
  if (cfg.MCP_GATEWAY_URL) {
    const url = cfg.MCP_GATEWAY_URL;
    const auth = new GoogleAuth();
    mcpGatewayClient = makeGatewayClient({
      baseUrl: url,
      getAuthHeader: async () => {
        try {
          const client = await auth.getIdTokenClient(url);
          const headers = await client.getRequestHeaders();
          const authz = (headers as Record<string, string>).Authorization ?? (headers as Record<string, string>).authorization;
          return authz ? { Authorization: authz } : ({} as Record<string, string>);
        } catch {
          return {}; // local/no-GCP creds → no auth header (gateway bypass when its audience is unset)
        }
      },
    });
  }

  let integrationToolsClient: ReturnType<typeof makeIntegrationToolsClient> | undefined;
  if (cfg.SERVER_BASE_URL) {
    const serverUrl = cfg.SERVER_BASE_URL;
    const audience = cfg.SERVER_AUDIENCE ?? serverUrl;   // stable audience, fallback preserves dev behavior
    const serverAuth = new GoogleAuth();
    integrationToolsClient = makeIntegrationToolsClient({
      baseUrl: serverUrl,
      getAuthHeader: async () => {
        try {
          const client = await serverAuth.getIdTokenClient(audience);   // stable audience, not the POST target
          const headers = await client.getRequestHeaders();
          const authz = (headers as Record<string, string>).Authorization ?? (headers as Record<string, string>).authorization;
          return authz ? { Authorization: authz } : ({} as Record<string, string>);
        } catch {
          return {}; // local/no-GCP creds → no auth header
        }
      },
    });
  }

  let engine: EngineRuntime | null = null;
  let verify: (token: string) => Promise<boolean> = async () => false;
  if (enabled) {
    const vertexAuth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
    const vertex = cfg.VERTEX_PROJECT
      ? {
          project: cfg.VERTEX_PROJECT,
          location: cfg.VERTEX_LOCATION,
          getAccessToken: async () => {
            const t = await vertexAuth.getAccessToken();
            if (!t) throw new Error('failed to obtain ADC access token for Vertex');
            return t;
          },
        }
      : undefined;
    engine = buildEngineDeps({
      store, geminiApiKey: cfg.GEMINI_API_KEY,
      vertex,
      secretsKey: cfg.SECRETS_KEY ? keyFromBase64(cfg.SECRETS_KEY) : undefined,
      teams: cfg.MICROSOFT_APP_ID && cfg.MICROSOFT_APP_PASSWORD && cfg.MICROSOFT_APP_TENANT_ID
        ? { appId: cfg.MICROSOFT_APP_ID, appPassword: cfg.MICROSOFT_APP_PASSWORD, tenantId: cfg.MICROSOFT_APP_TENANT_ID }
        : undefined,
      dispatcher: pubsubDispatcher(new PubSub().topic(cfg.PUBSUB_TOPIC!, { messageOrdering: true }) as unknown as OrderedTopic),
      models: catalogModelEntries(),
      trace: makeTurnTrace(db, getTracer(), logger),
      mcpGatewayClient,
      integrationToolsClient,
      reportBaseUrl: cfg.REPORT_PUBLIC_BASE_URL ?? cfg.SERVER_BASE_URL,
      creditsEnforced: cfg.CREDITS_ENFORCED,
      fxFallbackRate: cfg.BILLING_FX_USD_EUR,
    });
    verify = makePubsubVerifier({ audience: cfg.PUBSUB_PUSH_AUDIENCE!, saEmail: cfg.PUBSUB_PUSH_SA_EMAIL! });
  }

  const app = await buildWorkerApp({ engine, verify, logger });
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'engine-worker startup failed');
  process.exit(1);
}
