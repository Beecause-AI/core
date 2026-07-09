# Beecause

> Root cause analysis for engineering teams — easy, fast, and interactive.

Beecause is the open-core of [beecause.ai](https://beecause.ai), a managed SaaS that brings AI-powered root-cause analysis directly into Slack. This repository contains the open-source server, web app, and analysis engine under the Apache 2.0 license.

## Architecture

Hexagonal ports-and-adapters: a single tenancy-agnostic core with pluggable store adapters (Postgres + pgvector **or** Firestore + Vertex Vector Search) and auth adapters (local password, generic OIDC, or GCP Identity Platform).

## Quick start (self-hosted)

**Prerequisites:** Docker + Docker Compose, a Postgres 16 database (with pgvector extension), and an LLM API key (Anthropic or Google Vertex).

```bash
# 1. Clone and install
git clone https://github.com/Beecause-AI/core.git
cd core
pnpm install

# 2. Configure
cp .env.example .env
# Edit .env and set at minimum:
#   STORE_BACKEND=postgres
#   DATABASE_URL=postgres://beecause:beecause@localhost:5432/beecause
#   AUTH_BACKEND=local
#   TENANT_MODE=single
#   SINGLE_TENANT_SLUG=default
#   ADMIN_EMAIL=admin@example.com
#   ADMIN_PASSWORD=changeme
#   VECTOR_BACKEND=pgvector
#   SESSION_SECRET=<random 32+ chars>
#   BASE_URL=http://localhost:8080
#   ANTHROPIC_API_KEY=<your key>   # or set a Vertex / OpenAI key
# Note: GCP_PROJECT_ID is not required for Postgres + local auth.

# 3. Start infrastructure (Postgres with pgvector)
docker compose -f docker-compose.oss.yml up -d

# 4. Run
make dev-server   # terminal 1 — API on :8080
make dev-web      # terminal 2 — UI on :3000

# 5. Verify the server is up
curl http://localhost:8080/api/healthz   # → 200 {"status":"ok"}
# Then log in at http://localhost:3000/signin
```

See [docs/self-host-store.md](docs/self-host-store.md) for storage configuration and [docs/self-host-auth.md](docs/self-host-auth.md) for auth backend options.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache License 2.0 — see [LICENSE](LICENSE).
