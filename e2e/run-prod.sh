#!/usr/bin/env bash
# Runs the PROD end-to-end suite (e2e/tests/prod-flow.spec.ts) against the live
# stack. Pulls the required secrets from the local Pulumi backend:
#   - sessionSecret  → mint verify tokens (no email needs to be read)
#   - kcAdminSecret  → delete the test realm afterwards
#   - databaseUrl    → delete the test org/user rows afterwards
# Test identities use *@e2e.beecause.ai, which the server NEVER emails.
set -euo pipefail
cd "$(dirname "$0")/.."

export PULUMI_CONFIG_PASSPHRASE_FILE=$PWD/.pulumi-passphrase
PROD_SESSION_SECRET=$(cd infra && pulumi config get sessionSecret)
PROD_KC_ADMIN_SECRET=$(cd infra && pulumi config get kcAdminSecret)
PROD_DATABASE_URL=$(cd infra && pulumi config get databaseUrl)
export PROD_SESSION_SECRET PROD_KC_ADMIN_SECRET PROD_DATABASE_URL

# Stable per run: worker restarts re-evaluate the spec module; a fresh
# Date.now() there would silently switch slugs mid-suite.
export E2E_RUN_ID=$(date +%s | xargs printf '%x')

pnpm --filter @intellilabs/e2e exec playwright test prod-flow "$@"
