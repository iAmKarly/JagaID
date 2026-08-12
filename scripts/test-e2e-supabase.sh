#!/usr/bin/env bash
# scripts/test-e2e-supabase.sh
#
# Runs e2e tests against the TEST Supabase project locally.
#
# Strategy:
#   1. Load .env.test — all Supabase credentials
#   2. Kill any existing process on port 3000
#   3. Start dev server — it inherits ALL env vars from this shell
#   4. Wait until server responds, then seed test fixtures
#   5. Set REUSE_SERVER=true so playwright.config.ts reuses our server
#   6. Run Playwright — tests hit the server we seeded
#   7. global-teardown.ts cleans up fixtures via DELETE /api/e2e-seed
#   8. trap kills the dev server on exit
#
# Requires: .env.test (copy from .env.test.example and fill in)
# Usage:    npm run test:e2e:supabase

set -euo pipefail

CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${CYAN}[e2e]${NC} $1"; }
ok()   { echo -e "${GREEN}[e2e] ✓${NC} $1"; }
die()  { echo -e "${RED}[e2e] ✗${NC} $1"; exit 1; }
warn() { echo -e "${YELLOW}[e2e] ⚠${NC} $1"; }

# ── Must run from repo root ────────────────────────────────────────────────────
if [ ! -f "package.json" ]; then
  die "Run from the jagaid repo root: npm run test:e2e:supabase"
fi

# ── Check .env.test exists ─────────────────────────────────────────────────────
if [ ! -f ".env.test" ]; then
  echo ""
  echo -e "  ${RED}[e2e] .env.test not found.${NC}"
  echo ""
  echo "  Copy the template and fill in your test Supabase credentials:"
  echo "    cp .env.test.example .env.test"
  echo ""
  echo "  Required values from Supabase Dashboard → jagaid-test → Settings → API:"
  echo "    NEXT_PUBLIC_SUPABASE_URL"
  echo "    NEXT_PUBLIC_SUPABASE_ANON_KEY"
  echo "    SUPABASE_SERVICE_ROLE_KEY"
  echo "    USE_SUPABASE=true"
  echo "    NEXT_PUBLIC_USE_SUPABASE=true"
  echo "    E2E_SEED_KEY=<any random string>"
  echo "    ADMIN_UPLOAD_KEY=<any random string>"
  echo ""
  exit 1
fi

# ── Load .env.test into current shell ──────────────────────────────────────────
log "Loading .env.test..."
set -a
# shellcheck disable=SC1091
source .env.test
set +a

# ── Validate all required vars ─────────────────────────────────────────────────
: "${NEXT_PUBLIC_SUPABASE_URL:?Missing NEXT_PUBLIC_SUPABASE_URL in .env.test}"
: "${NEXT_PUBLIC_SUPABASE_ANON_KEY:?Missing NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.test}"
: "${SUPABASE_SERVICE_ROLE_KEY:?Missing SUPABASE_SERVICE_ROLE_KEY in .env.test}"
: "${E2E_SEED_KEY:?Missing E2E_SEED_KEY in .env.test}"
: "${ADMIN_UPLOAD_KEY:?Missing ADMIN_UPLOAD_KEY in .env.test}"
: "${USE_SUPABASE:?Missing USE_SUPABASE=true in .env.test}"

if [ "$USE_SUPABASE" != "true" ]; then
  die "USE_SUPABASE must be 'true' in .env.test"
fi

# ── Safety: do not use production credentials ──────────────────────────────────
PROD_URL=$(grep "^NEXT_PUBLIC_SUPABASE_URL=" .env.local 2>/dev/null | cut -d= -f2 || true)
if [ -n "$PROD_URL" ] && [ "$NEXT_PUBLIC_SUPABASE_URL" = "$PROD_URL" ]; then
  die "NEXT_PUBLIC_SUPABASE_URL in .env.test matches .env.local — use a separate test Supabase project, never production."
fi

ok "Test DB: $NEXT_PUBLIC_SUPABASE_URL"
echo ""

# ── Kill any existing process on port 3000 ────────────────────────────────────
if lsof -ti:3000 > /dev/null 2>&1; then
  log "Killing existing process on port 3000..."
  lsof -ti:3000 | xargs kill -9 2>/dev/null || true
  sleep 1
fi

# ── Start dev server — inherits ALL env vars from this shell ──────────────────
# This is the key: the server gets SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY,
# USE_SUPABASE, etc. all from the exported .env.test vars above.
log "Starting dev server with test Supabase credentials..."
npm run dev &
DEV_PID=$!

# Always kill on exit
cleanup() {
  log "Stopping dev server (PID: $DEV_PID)..."
  kill "$DEV_PID" 2>/dev/null || true
  wait "$DEV_PID" 2>/dev/null || true
  ok "Dev server stopped."
}
trap cleanup EXIT

# ── Wait for server ready ──────────────────────────────────────────────────────
log "Waiting for server on http://localhost:3000..."
MAX_WAIT=60
WAITED=0
until curl -sf "http://localhost:3000/api/stats" > /dev/null 2>&1; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    die "Server did not start within ${MAX_WAIT}s"
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
ok "Server ready (${WAITED}s)"

# ── Clean test DB then seed fresh fixtures ─────────────────────────────────────
# Always wipe e2e fixtures first — guarantees a clean slate every run,
# even if a previous run crashed before teardown could clean up.

log "Cleaning previous e2e fixtures from $NEXT_PUBLIC_SUPABASE_URL..."
CLEAN_RESPONSE=$(curl -sf -X DELETE   "http://localhost:3000/api/e2e-seed"   -H "Content-Type: application/json"   -H "x-e2e-key: ${E2E_SEED_KEY}" 2>&1)   || warn "Clean request failed (may be nothing to clean): $CLEAN_RESPONSE"
echo "  Clean: $CLEAN_RESPONSE"

log "Seeding fresh test fixtures..."
SEED_RESPONSE=$(curl -sf -X POST   "http://localhost:3000/api/e2e-seed"   -H "Content-Type: application/json"   -H "x-e2e-key: ${E2E_SEED_KEY}" 2>&1)   || die "Seed request failed: $SEED_RESPONSE"

echo "  Seed:  $SEED_RESPONSE"

if echo "$SEED_RESPONSE" | grep -q '"ok":true'; then
  ok "Fixtures seeded"
else
  die "Seed failed — response did not contain ok:true"
fi
echo ""

# ── Run Playwright reusing our server ─────────────────────────────────────────
# REUSE_SERVER=true → playwright.config.ts uses reuseExistingServer=true
# so Playwright does NOT kill and restart our server (which would lose env vars).
log "Running Playwright (workers=1, reusing server)..."
echo ""

REUSE_SERVER=true \
  node node_modules/@playwright/test/cli.js test --workers=1

E2E_EXIT=$?
echo ""

if [ "$E2E_EXIT" -eq 0 ]; then
  ok "All e2e tests passed."
else
  warn "Some tests failed — check playwright-report/ for details."
fi

# cleanup trap fires here
exit $E2E_EXIT
