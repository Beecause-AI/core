import { PubSub } from '@google-cloud/pubsub';
import { GoogleAuth } from 'google-auth-library';
import { createStore, startTracing, makeLogger, injectTraceContext } from '@intellilabs/core';
import { vertexEmbeddingProvider, vertexBaseUrl } from '@intellilabs/engine';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeIdpAdmin } from './integrations/idp/admin.js';
import { firebaseIdpAuth } from './integrations/idp/client.js';
import { makeResendSender } from './integrations/email/resend.js';
import { makeServiceVerifier } from './auth/service-verifier.js';

startTracing('server');
const logger = makeLogger({ service: 'server', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

try {
  const cfg = loadConfig();

  // Boot-time gate: when AUTH_BACKEND=oidc the three OIDC credentials are required.
  if (cfg.AUTH_BACKEND === 'oidc') {
    if (!cfg.OIDC_ISSUER || !cfg.OIDC_CLIENT_ID || !cfg.OIDC_CLIENT_SECRET) {
      logger.error(
        'AUTH_BACKEND=oidc but OIDC_ISSUER, OIDC_CLIENT_ID, or OIDC_CLIENT_SECRET is missing. ' +
        'Set all three environment variables before starting the server.',
      );
      process.exit(1);
    }
  }

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
  const idpAdmin = cfg.IDP_PROJECT_ID ? makeIdpAdmin(firebaseIdpAuth(cfg.IDP_PROJECT_ID)) : undefined;
  const email = cfg.RESEND_API_KEY ? makeResendSender({ apiKey: cfg.RESEND_API_KEY, from: cfg.EMAIL_FROM }) : undefined;

  const topic = cfg.PUBSUB_TOPIC
    ? new PubSub().topic(cfg.PUBSUB_TOPIC, { messageOrdering: true })
    : null;
  const slackPublish = topic
    ? async (laneId: string, turnId: string) => {
        await topic.publishMessage({ data: Buffer.from(JSON.stringify({ laneId, turnId })), orderingKey: laneId, attributes: injectTraceContext() });
      }
    : undefined;

  const kgTopic = cfg.KG_BUILD_TOPIC
    ? new PubSub().topic(cfg.KG_BUILD_TOPIC)
    : null;
  const kgJobPublisher = kgTopic
    ? { publish: async (job: import('@intellilabs/core').KgBuildJob) => { await kgTopic.publishMessage({ data: Buffer.from(JSON.stringify(job)), attributes: injectTraceContext() }); } }
    : undefined;

  const teamAutogenTopic = cfg.TEAM_AUTOGEN_TOPIC ? new PubSub().topic(cfg.TEAM_AUTOGEN_TOPIC) : null;
  const teamAutogenPublisher = teamAutogenTopic
    ? { publish: async (job: import('@intellilabs/core').TeamAutogenJob) => { await teamAutogenTopic.publishMessage({ data: Buffer.from(JSON.stringify(job)), attributes: injectTraceContext() }); } }
    : undefined;

  const reportGenTopic = cfg.REPORT_GEN_TOPIC ? new PubSub().topic(cfg.REPORT_GEN_TOPIC) : null;
  const reportGenPublisher = reportGenTopic
    ? { publish: async (job: import('@intellilabs/core').ReportGenJob) => { await reportGenTopic.publishMessage({ data: Buffer.from(JSON.stringify(job)), attributes: injectTraceContext() }); } }
    : undefined;

  const embed = cfg.VERTEX_PROJECT
    ? (() => {
        const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
        const base = vertexBaseUrl(cfg.VERTEX_PROJECT!, cfg.VERTEX_LOCATION);
        return async (texts: string[]) => {
          const t = await auth.getAccessToken();
          if (!t) throw new Error('server: failed to obtain ADC token for Vertex embed');
          return vertexEmbeddingProvider.embed(texts, { apiKey: t, baseUrl: base });
        };
      })()
    : undefined;

  const serviceVerify = makeServiceVerifier(cfg);
  // Install-time seed: create the single org + admin user when running in single-tenant
  // local-auth mode and the admin credentials are configured.
  if (cfg.TENANT_MODE === 'single' && cfg.AUTH_BACKEND === 'local') {
    if (cfg.ADMIN_EMAIL && cfg.ADMIN_PASSWORD) {
      const { seedSingleTenant } = await import('./seed.js');
      await seedSingleTenant(store.db, cfg, logger);
    } else {
      logger.warn('single-tenant local mode but ADMIN_EMAIL/ADMIN_PASSWORD unset — skipping seed');
    }
  }
  // Teams reuses the same message_queue topic + doorbell as Slack (no new topic).
  const app = await buildApp({ db, store, config: cfg, idpAdmin, email, slackPublish, teamsPublish: slackPublish, kgJobPublisher, teamAutogenPublisher, reportGenPublisher, embed, verifyServiceAuth: (req) => serviceVerify(req.headers.authorization), logger });
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'server startup failed');
  process.exit(1);
}
