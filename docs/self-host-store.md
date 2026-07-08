# Self-Host Store (OSS — Postgres backend)

This covers the **store layer only**: how to run Beecause against a local Postgres database instead of Google Firestore. Full self-host (single-tenant auth, local LLM, proprietary carve-out) is a separate workstream.

## Quick start

1. Start Postgres:

```sh
docker compose -f docker-compose.oss.yml up -d
```

2. Set environment variables (copy from `.env.example`, OSS section):

```
STORE_BACKEND=postgres
DATABASE_URL=postgres://beecause:beecause@localhost:5432/beecause
VECTOR_BACKEND=pgvector     # persistent vector search (recommended)
# VECTOR_DIM=768            # embedding dimension (default 768)
```

For development / evaluation without persistent vectors use `VECTOR_BACKEND=inmemory` instead.

3. Create the schema. The apps call `createSchema` lazily (tables are created on first access), but you can also run it eagerly:

```ts
import { Pool } from 'pg';
import { createSchema } from '@intellilabs/core/adapters/store/postgres';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await createSchema(pool);
await pool.end();
```

`createSchema` creates one table per collection in `COLLECTIONS` (see `packages/core/src/store/collections.ts`) plus expression indexes on `orgId` and `createdAt` for every table — these cover the hot query patterns.

## Vector search

Set `VECTOR_BACKEND=pgvector` for **persistent** vector search (memory.recall, knowledge-graph semantic recall) backed by the `pgvector` Postgres extension. The schema (`CREATE EXTENSION vector` + `vector_points` table) is created **lazily on first use** — no manual migration step is required after you configure the env var. Your Postgres image must include the pgvector extension (e.g. `pgvector/pgvector:pg16`).

`VECTOR_DIM` sets the embedding dimension (default `768` for Vertex/text-embedding-004). Only change this if you swap embedding models.

With `VECTOR_BACKEND=inmemory`, semantic search features are **non-persistent in-memory only** — useful for development and evaluation, not production. With `VECTOR_BACKEND` unset (or any other value), those features are inert.

## What is NOT covered here

- Single-tenant identity / auth (Identity Platform / Keycloak replacement)
- Local LLM wiring (BYOK via `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` env vars is sufficient for most use cases)
- Proprietary code carve-out (separate OSS-extraction workstream)

## Hardening

The OSS operator owns the edge, so online-guessing protection is your responsibility:

- **Rate-limit `POST /auth/password`** at the reverse proxy (nginx, Caddy) or WAF layer, per-IP and per-account. scrypt raises the per-attempt cost but does not stop an attacker who is willing to wait between requests. Tools like `fail2ban`, an nginx `limit_req_zone`, or a Caddy rate-limit plugin are straightforward choices.
- **Set a strong `SESSION_SECRET`** (≥ 32 random characters). A weak or default secret lets an attacker forge session tokens offline.
- **Set a strong `ADMIN_PASSWORD`** for the super-admin console.
