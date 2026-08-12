#!/usr/bin/env bash
# scripts/setup.sh
# One-command dev setup for JagaID — works on macOS and Linux
# Usage: bash scripts/setup.sh

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $1"; }
ok()   { echo -e "${GREEN}[setup] ✓${NC} $1"; }
warn() { echo -e "${YELLOW}[setup] ⚠${NC} $1"; }
die()  { echo -e "${RED}[setup] ✗${NC} $1"; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}     ██╗ █████╗  ██████╗  █████╗ ██╗██████╗${NC}"
echo -e "${GREEN}     ██║██╔══██╗██╔════╝ ██╔══██╗██║██╔══██╗${NC}"
echo -e "${GREEN}     ██║███████║██║  ███╗███████║██║██║  ██║${NC}"
echo -e "${GREEN} ██╗ ██║██╔══██║██║   ██║██╔══██║██║██║  ██║${NC}"
echo -e "${GREEN} █████╔╝██║  ██║╚██████╔╝██║  ██║██║██████╔╝${NC}"
echo -e "${GREEN} ╚════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝╚═════╝${NC}"
echo ""
echo -e "  ${CYAN}Anti-Fraud Platform — Development Setup${NC}"
echo ""

# ── Must run from repo root ───────────────────────────────────────────────────
if [ ! -f "package.json" ]; then
  die "Run this script from the jagaid repo root: bash scripts/setup.sh"
fi

# ── Detect OS ─────────────────────────────────────────────────────────────────
OS="$(uname -s)"
log "Detected OS: $OS"

# ── Check Node.js ─────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo ""
  echo -e "  ${RED}Node.js not found.${NC} Install it first:"
  echo ""
  if [ "$OS" = "Darwin" ]; then
    echo -e "    ${CYAN}brew install node${NC}           (Homebrew)"
    echo -e "    ${CYAN}https://nodejs.org${NC}          (direct download)"
  else
    echo -e "    ${CYAN}curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -${NC}"
    echo -e "    ${CYAN}sudo apt-get install -y nodejs${NC}"
  fi
  echo ""
  exit 1
fi

NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 18 ]; then
  die "Node.js v18+ required (found v${NODE_VER}). Upgrade at https://nodejs.org"
fi
ok "Node.js v${NODE_VER}"

# ── Check npm ─────────────────────────────────────────────────────────────────
if ! command -v npm &>/dev/null; then
  die "npm not found — it should come bundled with Node.js. Try reinstalling Node."
fi
ok "npm $(npm --version)"

# ── Install dependencies ──────────────────────────────────────────────────────
log "Installing dependencies..."
npm install 2>&1 | tail -5
ok "Dependencies installed"

# ── Copy .env if missing ──────────────────────────────────────────────────────
if [ ! -f ".env.local" ]; then
  if [ -f ".env.example" ]; then
    cp .env.example .env.local
    warn ".env.local created from .env.example — fill in your Supabase keys before running"
  else
    warn ".env.example not found — skipping .env.local creation"
  fi
else
  ok ".env.local already exists"
fi

# ── Copy .env.test if missing ─────────────────────────────────────────────────
if [ ! -f ".env.test" ]; then
  if [ -f ".env.test.example" ]; then
    cp .env.test.example .env.test
    warn ".env.test created from .env.test.example — fill it with TEST Supabase keys only"
  else
    warn ".env.test.example not found — skipping .env.test creation"
  fi
else
  ok ".env.test already exists"
fi

# ── Create data dir if missing ────────────────────────────────────────────────
mkdir -p data
ok "data/ directory ready"

# ── Install Playwright browsers (optional, skip if it fails) ─────────────────
log "Installing Playwright browsers (Chromium only — this may take a minute)..."
if node node_modules/@playwright/test/cli.js install chromium --with-deps 2>&1 | tail -3; then
  ok "Playwright Chromium ready"
else
  warn "Playwright install failed — e2e tests won't run. Fix with: npx playwright install chromium"
fi

# ── Run unit tests to verify setup ───────────────────────────────────────────
log "Running unit tests to verify setup..."
if node node_modules/jest/bin/jest.js --passWithNoTests 2>&1 | tail -8; then
  ok "All tests passing"
else
  warn "Some tests failed — check output above"
fi

# ── Optional real Supabase e2e verification ───────────────────────────────────
if [ "${RUN_SUPABASE_E2E:-0}" = "1" ]; then
  log "Running Supabase e2e tests against .env.test..."
  if npm run test:e2e:supabase; then
    ok "Supabase e2e tests passing"
  else
    warn "Supabase e2e tests failed — check output above"
  fi
else
  log "Skipping Supabase e2e tests. Run with RUN_SUPABASE_E2E=1 bash scripts/setup.sh after filling .env.test."
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  ✅  Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  ${CYAN}Development${NC}"
echo -e "    npm run dev              Start dev server → http://localhost:3000"
echo ""
echo -e "  ${CYAN}Testing${NC}"
echo -e "    npm test                 Unit + integration tests"
echo -e "    npm run test:coverage    Tests with coverage report"
echo -e "    npm run test:e2e         E2E browser tests (needs: playwright install + dev server)"
echo -e "    npm run test:e2e:supabase E2E against .env.test Supabase DB"
echo -e "    npm run test:ci          Full suite incl. e2e (needs: playwright install + dev server)"
echo ""
echo -e "  ${CYAN}Database${NC}"
echo -e "    npm run db:seed          Seed Supabase with dev data"
echo -e "    npm run reset:db         Wipe all rows (with confirmation)"
echo -e "    npm run scrape:ojk       Scrape OJK → data/ojk-scraped.json"
echo -e "    npm run scrape           Alias for scrape:ojk"
echo -e "    npm run import:ojk       Push scraped data → Supabase"
echo -e "    npm run db:seed -- --test    Seed the .env.test Supabase project"
echo -e "    npm run reset:db -- --test   Wipe the .env.test Supabase project"
echo ""
echo -e "  ${CYAN}Full data refresh${NC}"
echo -e "    npm run reset:db && npm run scrape:ojk && npm run import:ojk"
echo ""
echo -e "  ${YELLOW}⚠  Fill in .env.local with your Supabase keys before running DB commands.${NC}"
echo -e "  ${YELLOW}⚠  Fill in .env.test with TEST Supabase keys before running Supabase e2e.${NC}"
echo ""
