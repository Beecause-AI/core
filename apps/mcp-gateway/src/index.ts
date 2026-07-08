import { createStore, listMcpServers, mcpServerToken, keyFromBase64, startTracing, makeLogger } from '@intellilabs/core';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { McpGateway } from './gateway.js';
import { realClientFactory } from './mcp-client.js';
import { makeGatewayVerifier } from './auth.js';

startTracing('mcp-gateway');
const logger = makeLogger({ service: 'mcp-gateway', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

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

  const gateway = new McpGateway({
    loadServers: (orgId) => listMcpServers(db, orgId),
    clientFactory: realClientFactory,
    tokenFor: (server) =>
      cfg.SECRETS_KEY ? mcpServerToken(server, keyFromBase64(cfg.SECRETS_KEY)) : null,
  });

  const app = await buildApp({ db, gateway, verifyAuth: makeGatewayVerifier(cfg), logger });
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'mcp-gateway startup failed');
  process.exit(1);
}
