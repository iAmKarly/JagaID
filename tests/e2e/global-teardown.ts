/**
 * tests/e2e/global-teardown.ts
 *
 * Runs once after ALL Playwright tests complete.
 *
 * In seed-fallback mode (npm run test:e2e):
 *   No-op — SEED_DB is in-memory, nothing to clean.
 *
 * In Supabase mode (npm run test:e2e:supabase):
 *   Calls DELETE /api/e2e-seed to remove all e2e_ prefixed test fixtures
 *   from the test Supabase project, leaving it clean for the next run.
 *
 * Note: the shell script also runs DELETE before seeding (clean-before-seed),
 * so even if teardown is skipped (e.g. process killed), the next run is safe.
 */

import { FullConfig } from "@playwright/test";

const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3000";
const KEY = process.env.E2E_SEED_KEY;
const IS_SUPABASE =
  process.env.USE_SUPABASE === "true" || process.env.NEXT_PUBLIC_USE_SUPABASE === "true";

async function globalTeardown(_config: FullConfig) {
  if (!IS_SUPABASE || !KEY) return;

  try {
    const res = await fetch(`${BASE}/api/e2e-seed`, {
      method: "DELETE",
      headers: { "x-e2e-key": KEY },
    });
    const json = (await res.json()) as {
      ok?: boolean;
      mode?: string;
      cleaned?: string[];
    };
    if (json.ok) {
      console.log(`[e2e-teardown] ✓ Test fixtures cleaned (mode: ${json.mode})`);
      if (json.cleaned) {
        console.log(`[e2e-teardown]   Removed: ${json.cleaned.join(", ")}`);
      }
    }
  } catch (err) {
    // Non-fatal — next run's clean-before-seed will handle leftover fixtures
    console.warn("[e2e-teardown] Could not clean fixtures:", err);
    console.warn("[e2e-teardown] The next run will clean them before seeding.");
  }
}

export default globalTeardown;
