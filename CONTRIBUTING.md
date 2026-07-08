# Contributing to Beecause

Thank you for your interest in contributing!

## Getting started

1. **Fork** the repository and clone your fork.
2. Install dependencies: `pnpm install` (Node >= 22, pnpm >= 10 required).
3. Start infrastructure: `docker compose -f docker-compose.oss.yml up -d`
4. Run tests: `pnpm test`

## Repository structure

| Path | Contents |
|------|----------|
| `packages/core` | Domain model + store/auth/vector ports (no framework deps) |
| `packages/engine` | LLM orchestration engine |
| `packages/billing` | Credit-ledger domain logic |
| `apps/server` | Fastify API server |
| `apps/web` | Next.js web app |
| `apps/engine-worker` | Pub/Sub-driven engine worker |
| `apps/graph-builder` | Knowledge-graph build worker |
| `apps/mcp-gateway` | MCP protocol gateway |

## Boundaries

We enforce dependency-cruiser boundaries to keep `packages/core` framework-free:

```bash
pnpm lint:boundaries
```

The rule: `packages/core` must not import from `packages/engine`, `apps/*`, or any cloud SDK.

## Tests

```bash
pnpm test          # run all package tests
pnpm -r exec tsc --noEmit  # type-check all packages
```

## Pull requests

- Keep PRs focused — one logical change per PR.
- Add or update tests for any changed behaviour.
- Run `pnpm lint:boundaries` before opening a PR.
- Use a short imperative subject line (e.g. `fix: handle empty ledger on credit checkout`).
- Sign-off (DCO) is optional but appreciated: `git commit -s`.

## Code of conduct

Be kind. We follow the [Contributor Covenant](https://www.contributor-covenant.org/).
