import { defineConfig, devices } from "@playwright/test";

// Two modes:
//
// SEED-FALLBACK (npm run test:e2e):
//   Playwright starts dev server itself with USE_SUPABASE=false.
//   No Supabase needed. Safe to run anytime.
//
// SUPABASE (npm run test:e2e:supabase):
//   test-e2e-supabase.sh sources .env.test, starts the dev server with
//   all Supabase credentials, seeds fixtures, then sets REUSE_SERVER=true
//   so Playwright reuses that already-running server unchanged.
//   Playwright must NOT kill and restart the server — it would lose the env.

const reuseServer = process.env.REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // workers=1 when reusing server (Supabase mode) — prevents concurrent DB writes
  // fullyParallel in seed-fallback — each worker has its own in-memory SEED_DB
  fullyParallel: !reuseServer,
  workers: reuseServer ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile Safari", use: { ...devices["iPhone 13"] } },
  ],
  webServer: reuseServer
    ? {
        // Supabase mode: server already running with correct env — just reuse it
        command: "echo 'Reusing existing dev server'",
        url: "http://localhost:3000",
        reuseExistingServer: true,
        timeout: 5_000,
      }
    : {
        // Seed-fallback mode: start fresh, force SEED_DB regardless of .env.local
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: false,
        timeout: 60_000,
        env: {
          USE_SUPABASE: "false",
          NEXT_PUBLIC_USE_SUPABASE: "false",
        },
      },
});
