import { z } from 'zod';

const Env = z.object({
  GCP_PROJECT_ID: z.string(),
  FIRESTORE_EMULATOR_HOST: z.string().optional(),
  // Vertex Vector Search (memories + KG embeddings). Optional so emulator/local boots
  // without a deployed index; vector-search calls are inert until these are set.
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
  PUBSUB_TOPIC: z.string().optional(),
  PUBSUB_PUSH_AUDIENCE: z.string().optional(),
  PUBSUB_PUSH_SA_EMAIL: z.string().optional(),
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().default('global'),
  GEMINI_API_KEY: z.string().optional(),
  SECRETS_KEY: z.string().optional(),
  MICROSOFT_APP_ID: z.string().optional(),
  MICROSOFT_APP_PASSWORD: z.string().optional(),   // Entra client secret value (infra wires via Secret Manager)
  MICROSOFT_APP_TENANT_ID: z.string().optional(),  // home tenant id (single-tenant Azure Bot)
  MCP_GATEWAY_URL: z.string().url().optional(),
  SERVER_BASE_URL: z.string().url().optional(),
  SERVER_AUDIENCE: z.string().optional(),   // stable OIDC audience for /int ID tokens; falls back to SERVER_BASE_URL
  REPORT_PUBLIC_BASE_URL: z.string().url().optional(), // public domain for report links (not the internal run.app URL)
  CREDITS_ENFORCED: z.coerce.boolean().default(false),  // gate: debit + block AI on empty balance
  BILLING_FX_USD_EUR: z.coerce.number().default(0.92),  // USD→EUR fallback when the ECB feed is unreachable
});

export type WorkerConfig = z.infer<typeof Env>;
export function loadConfig(): WorkerConfig {
  return Env.parse(process.env);
}
