import { createStore, realGithubClient, recordModelInvocation, startTracing, makeLogger, injectTraceContext } from '@intellilabs/core';
import { skillsFor, listSkills } from '@intellilabs/kg-skills';
import { PubSub } from '@google-cloud/pubsub';
import { GoogleAuth } from 'google-auth-library';
import { runToText, vertexEmbeddingProvider, vertexBaseUrl, googleVertexProvider } from '@intellilabs/engine';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { makeServiceVerifier } from './auth.js';
import { runPhase, type KgPublisher, type InvocationRecord } from './run-phase.js';
import { runTeamAutogen } from './team-autogen.js';
import type { BuildJob } from './app.js';
import type { RepoClient } from './repo-reader.js';

startTracing('graph-builder');
const logger = makeLogger({ service: 'graph-builder', projectId: process.env.GCP_PROJECT_ID ?? 'local' });

try {
  const cfg = loadConfig();
  const verifyServiceAuth = makeServiceVerifier(cfg);

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

  // Vertex AI semantic seam (Pass B). Platform creds via ADC, mirroring engine-worker.
  // Unset VERTEX_PROJECT (local/tests) leaves `semantic` undefined → Pass B is skipped.
  const semantic = cfg.VERTEX_PROJECT
    ? (() => {
        const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
        const token = async () => {
          const t = await auth.getAccessToken();
          if (!t) throw new Error('graph-builder: failed to obtain ADC token for Vertex');
          return t;
        };
        const base = vertexBaseUrl(cfg.VERTEX_PROJECT!, cfg.VERTEX_LOCATION);
        return {
          // _orgId unused for now (platform creds via ADC); kept for future BYOK.
          llm: async (_orgId: string, prompt: string) => {
            const apiKey = await token();
            return runToText(
              googleVertexProvider,
              { model: 'gemini-3.1-pro-preview', messages: [{ role: 'user', content: prompt }], maxOutputTokens: 8192 },
              { apiKey, baseUrl: base },
            );
          },
          embed: async (_orgId: string, texts: string[]) => {
            const apiKey = await token();
            return vertexEmbeddingProvider.embed(texts, { apiKey, baseUrl: base });
          },
        };
      })()
    : undefined;

  // Re-enqueue publisher for the per-phase state machine. Publishes the next phase to
  // the kg-build topic (runSa has publisher rights). No KG_BUILD_TOPIC (local/tests) →
  // a no-op so a phase still completes its writes without enqueuing the next.
  const kgPublisher: KgPublisher = cfg.KG_BUILD_TOPIC
    ? (() => {
        const topic = new PubSub().topic(cfg.KG_BUILD_TOPIC!);
        return {
          publish: async (job: BuildJob) => {
            await topic.publishMessage({ data: Buffer.from(JSON.stringify(job)), attributes: injectTraceContext() });
          },
        };
      })()
    : { publish: async () => {} };

  const runDeps = {
    db,
    store,
    // GithubClient is structurally compatible with RepoClient (all three methods present
    // with compatible signatures; RepoClient uses `any` for creds, GithubClient uses
    // the concrete Creds type — TypeScript accepts this direction).
    client: realGithubClient as unknown as RepoClient,
    config: {
      SECRETS_KEY: cfg.SECRETS_KEY,
      GITHUB_APP_ID: cfg.GITHUB_APP_ID,
      GITHUB_APP_PRIVATE_KEY: cfg.GITHUB_APP_PRIVATE_KEY,
    },
    semantic,
    recordInvocation: (rec: InvocationRecord) => recordModelInvocation(db, rec),
    kgPublisher,
    skills: { skillsFor, listSkills },
  };

  // Doorbell publisher for the engine-worker "turns" topic (ordered by lane), so the agentic
  // team-gen fleet can trigger the engine-worker to run its enqueued analysis turns. Unset
  // PUBSUB_TOPIC (local/tests) ⇒ undefined ⇒ team-gen falls back to the digest pipeline.
  const publishTurn = cfg.PUBSUB_TOPIC
    ? (() => {
        const topic = new PubSub().topic(cfg.PUBSUB_TOPIC!, { messageOrdering: true });
        return async (laneId: string, turnId: string) => {
          await topic.publishMessage({ data: Buffer.from(JSON.stringify({ laneId, turnId })), orderingKey: laneId, attributes: injectTraceContext() });
        };
      })()
    : undefined;

  const app = await buildApp({
    verifyServiceAuth,
    logger,
    onBuild: (job) => runPhase(runDeps, job),
    onTeamAutogen: (job) => runTeamAutogen({
      db,
      client: realGithubClient as unknown as RepoClient,
      config: { SECRETS_KEY: cfg.SECRETS_KEY, GITHUB_APP_ID: cfg.GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY: cfg.GITHUB_APP_PRIVATE_KEY },
      publishTurn,
    }, job),
  });

  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
} catch (err) {
  logger.error({ err }, 'graph-builder startup failed');
  process.exit(1);
}
