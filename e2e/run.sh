#!/usr/bin/env bash
# Orchestrates the local stack and runs the Playwright signup-flow E2E.
#   postgres + keycloak (docker compose) → migrate → master kc-admin client →
#   server :8080 → web :3000 → marketing :3001 → playwright
set -euo pipefail
cd "$(dirname "$0")/.."

# E2E must NEVER send real emails: no RESEND_API_KEY (no email sender on the
# server, no SMTP block in provisioned realms) + AUTO_VERIFY_EMAIL=true (signup
# returns the verify token inline instead of emailing it). Unset defensively in
# case the caller's shell exports it.
unset RESEND_API_KEY

LOGDIR=$(mktemp -d /tmp/intellilabs-e2e.XXXX)
PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "logs: $LOGDIR"
}
trap cleanup EXIT

echo "--- docker compose up (postgres, keycloak)"
docker compose up -d
echo -n "waiting for keycloak"
for _ in $(seq 1 120); do
  curl -fsS http://localhost:8081/realms/master >/dev/null 2>&1 && break
  echo -n .; sleep 2
done; echo

echo "--- migrate"
DATABASE_URL=postgres://intellilabs:intellilabs@localhost:5432/intellilabs \
  pnpm --filter @intellilabs/core exec tsx src/db/migrate.ts

echo "--- master kc-admin client"
KC_SECRET=$(KC_URL=http://localhost:8081 KC_ADMIN_USER=admin KC_ADMIN_PASS=admin \
  bash infra/keycloak/configure.sh | tail -1)
echo "kc-admin secret acquired (${#KC_SECRET} chars)"

echo "--- server :8080"
DATABASE_URL=postgres://intellilabs:intellilabs@localhost:5432/intellilabs \
SESSION_SECRET='e2e-session-secret-must-be-32-chars!' \
BASE_URL=http://localhost:3000 \
KC_ADMIN_BASE=http://localhost:8081 \
KC_ADMIN_CLIENT_ID=kc-admin \
KC_ADMIN_CLIENT_SECRET="$KC_SECRET" \
AUTO_VERIFY_EMAIL=true \
NODE_ENV=development \
PORT=8080 \
  pnpm --filter @intellilabs/server exec tsx src/index.ts > "$LOGDIR/server.log" 2>&1 &
PIDS+=($!)

echo "--- web :3000, marketing :3001"
pnpm --filter @intellilabs/web exec next dev -p 3000 > "$LOGDIR/web.log" 2>&1 &
PIDS+=($!)
pnpm --filter @intellilabs/marketing exec next dev -p 3001 > "$LOGDIR/marketing.log" 2>&1 &
PIDS+=($!)

echo -n "waiting for services"
for url in http://localhost:8080/api/healthz http://localhost:3000 http://localhost:3001; do
  for _ in $(seq 1 60); do
    curl -fsS "$url" >/dev/null 2>&1 && break
    echo -n .; sleep 2
  done
done; echo

echo "--- playwright"
# Stable per run: worker restarts re-evaluate the spec module; a fresh
# Date.now() there would silently switch slugs mid-suite.
export E2E_RUN_ID=$(date +%s | xargs printf '%x')

pnpm --filter @intellilabs/e2e exec playwright test "$@"
