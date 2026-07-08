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
  SESSION_SECRET: z.string().min(32),
  BASE_URL: z.url(),
  PORT: z.coerce.number().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  COOKIE_DOMAIN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  // GCP Identity Platform project that holds per-org tenants. When unset the
  // IdP admin layer is inert.
  IDP_PROJECT_ID: z.string().optional(),
  // GCP Identity Platform Web API key (the project "Browser key"), used for the
  // server-side password sign-in REST call. Unset → password auth route is inert.
  IDP_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default('no-reply@beecause.ai'),
  AUTO_VERIFY_EMAIL: z.coerce.boolean().default(false),
  // Super console: comma-separated allowlist + Firebase project for ID-token iss/aud.
  SUPER_ADMIN_EMAILS: z.string().default(''),
  FIREBASE_PROJECT_ID: z.string().optional(),
  SECRETS_KEY: z.string().optional(),       // base64 32-byte AES key for BYOK encryption (infra wires it)
  AWS_BASE_ACCESS_KEY_ID: z.string().optional(),      // platform IAM key for STS AssumeRole (assume_role mode only)
  AWS_BASE_SECRET_ACCESS_KEY: z.string().optional(),  // infra wires these as Secret Manager refs when assume_role is enabled
  AWS_BASE_REGION: z.string().optional(),             // region for the STS AssumeRole call
  AZURE_BASE_TENANT_ID: z.string().optional(),          // platform Entra tenant for workload_identity (federated) mode only
  AZURE_BASE_CLIENT_ID: z.string().optional(),          // platform managed-identity / app client id; infra wires when workload_identity is enabled
  AZURE_BASE_FEDERATION_AUDIENCE: z.string().optional(), // federation token audience for the platform-identity exchange
  // Project that the super error-generator reports synthetic errors into (our own
  // prod project). Unset → the generator route returns a clear 500.
  GCP_ERROR_REPORT_PROJECT: z.string().optional(),
  // GitHub App (global, one IntelliLabs Agent App). All optional so test config stays minimal.
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),            // defaults to 'intellilabs-agent' in code when unset
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),     // PEM contents
  GITHUB_APP_WEBHOOK_SECRET: z.string().optional(),  // used by the webhook pipeline
  INTEGRATION_STATE_SECRET: z.string().optional(),   // HMAC for install state; falls back to SESSION_SECRET
  // Slack app (global, one IntelliLabs Slack app). All optional so test config stays minimal.
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SLACK_SIGNING_SECRET: z.string().optional(),   // inbound request verification (used by Spec 2)
  MICROSOFT_APP_ID: z.string().optional(),
  MICROSOFT_APP_PASSWORD: z.string().optional(),   // Entra client secret value (infra wires via Secret Manager)
  MICROSOFT_APP_TENANT_ID: z.string().optional(),  // home tenant id (single-tenant Azure Bot)
  // Stripe billing (all optional → billing is inert until provisioned; infra wires the secrets).
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_STARTUP: z.string().optional(),   // Stripe recurring Price id for the Startup band
  STRIPE_PRICE_SCALEUP: z.string().optional(),   // Stripe recurring Price id for the Scaleup band
  PUBSUB_TOPIC: z.string().optional(),           // GCP Pub/Sub topic for worker doorbells (wired in later infra task)
  KG_BUILD_TOPIC: z.string().optional(),         // GCP Pub/Sub topic for knowledge-graph build jobs
  TEAM_AUTOGEN_TOPIC: z.string().optional(),     // GCP Pub/Sub topic for team auto-generation jobs
  REPORT_GEN_TOPIC: z.string().optional(),       // GCP Pub/Sub topic for report generation jobs
  MCP_GATEWAY_URL: z.url().optional(),   // MCP gateway base URL; unset → no MCP tools listed
  SERVICE_AUDIENCE: z.url().optional(),      // this server's run.app URL; expected aud of engine ID tokens for /int
  INVOKER_SA_EMAIL: z.string().optional(),   // engine-worker service-account email allowed to call /int
  // Vertex AI embeddings (for team-memory CRUD). Unset → embed is unavailable.
  VERTEX_PROJECT: z.string().optional(),
  VERTEX_LOCATION: z.string().default('global'),
  CREDITS_ENFORCED: z.coerce.boolean().default(false),
  BILLING_FX_USD_EUR: z.coerce.number().default(0.92),
  // Single-tenant / OSS mode. TENANT_MODE=subdomain (default) preserves the existing
  // SaaS subdomain-based org resolution. TENANT_MODE=single ignores the host and always
  // loads the one org named by SINGLE_TENANT_SLUG (default 'default').
  TENANT_MODE: z.enum(['subdomain', 'single']).optional(),
  SINGLE_TENANT_SLUG: z.string().optional(),
  // Auth backend. 'gcp' (default) uses GCP Identity Platform (requires IDP_API_KEY).
  // 'local' uses scrypt password hashing stored in the users collection (OSS mode).
  // 'oidc' delegates authentication to an external OIDC provider (Authorization Code + PKCE).
  AUTH_BACKEND: z.enum(['gcp', 'local', 'oidc']).optional(),
  // Generic OIDC provider (AUTH_BACKEND=oidc). All optional so other backends boot without them.
  // When AUTH_BACKEND=oidc, OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET are required
  // (validated at boot in index.ts with a clear process.exit(1) message).
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URI: z.string().url().optional(),
  OIDC_SCOPES: z.string().optional(),
  // Escape hatch: set to 'true' ONLY for a trusted IdP that omits email_verified.
  // By default (secure) the callback rejects logins where email_verified !== true.
  OIDC_ALLOW_UNVERIFIED_EMAIL: z.enum(['true', 'false']).optional(),
  // Install-time seed (single-tenant + local-auth mode only). When both are set the
  // server creates the org + admin user on boot if they do not already exist.
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(1).optional(),
  // OSS self-serve signup. 'true' opens POST /auth/register for unauthenticated new-user
  // creation. Off by default — admin-invite is the safer default even in single-tenant mode.
  LOCAL_SIGNUP_ENABLED: z.enum(['true', 'false']).optional(),
});

export type AppConfig = z.infer<typeof Env>;
export function loadConfig(): AppConfig {
  return Env.parse(process.env);
}
