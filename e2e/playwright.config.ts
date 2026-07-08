import { defineConfig } from '@playwright/test';

// The stack (postgres, keycloak, server, web, marketing) is orchestrated by
// run.sh — this config only drives the browser. One worker: the flow founds a
// uniquely-slugged workspace per run, but Keycloak realm creation is heavy.
export default defineConfig({
  testDir: './tests',
  // Cleanup decoupled from worker lifecycle: a mid-suite failure respawns the
  // worker and would re-run a worker-scoped afterAll, deleting the shared test
  // org while later tests need it. No-op for dev runs (no PROD_* env).
  globalTeardown: './global-teardown.ts',
  timeout: 120_000,
  workers: 1,
  retries: 0,
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
