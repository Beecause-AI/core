import { z } from 'zod';

const Env = z.object({
  GCP_PROJECT_ID: z.string(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  // Vertex Vector Search. The gateway does not use vector search itself, but createStore
  // requires the config; optional/empty so emulator/local boots without a deployed index.
  VECTOR_LOCATION: z.string().default('us-central1'),
  VECTOR_INDEX_ID: z.string().default(''),
  VECTOR_INDEX_ENDPOINT_ID: z.string().default(''),
  VECTOR_DEPLOYED_INDEX_ID: z.string().default(''),
  // 'firestore' → use Firestore native vector search (budget-friendly). Unset → Vertex if
  // provisioned, else inert. Compared with === 'firestore', so any other value is a no-op.
  // 'pgvector' → persistent Postgres + pgvector (backend=postgres only).
  // 'inmemory'  → non-persistent in-memory index (backend=postgres, dev/eval).
  VECTOR_BACKEND: z.string().optional(),
  // Embedding dimension for pgvector (default 768). Only relevant when VECTOR_BACKEND=pgvector.
  VECTOR_DIM: z.coerce.number().optional(),
  STORE_BACKEND: z.enum(['firestore', 'postgres']).optional(),
  DATABASE_URL: z.string().optional(),
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SECRETS_KEY: z.string().optional(),
  GATEWAY_AUDIENCE: z.string().optional(),
  INVOKER_SA_EMAIL: z.string().optional(),
});

export type GatewayConfig = z.infer<typeof Env>;
export function loadConfig(): GatewayConfig {
  return Env.parse(process.env);
}
