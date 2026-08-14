# JagaID — Complete Project Reference

Single document covering everything. Read README.md for quick start.
Read CLAUDE.md for AI assistant context. This file is the deep reference.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repository Structure](#2-repository-structure)
3. [Architecture](#3-architecture)
4. [Database Schema](#4-database-schema)
5. [API Reference](#5-api-reference)
6. [Environment Variables](#6-environment-variables)
7. [npm Scripts](#7-npm-scripts)
8. [Test Environments](#8-test-environments)
9. [Data Pipeline](#9-data-pipeline)
10. [Deployment](#10-deployment)
11. [Configuration Files](#11-configuration-files)
12. [Risk Scoring](#12-risk-scoring)
13. [Common Issues and Fixes](#13-common-issues-and-fixes)
14. [Decisions Log](#14-decisions-log)

---

## 1. Project Overview

JagaID is a community-powered anti-fraud intelligence platform for Indonesia.

**What it does:**

- Check if a bank account, phone number, e-wallet, or domain has been reported for fraud
- Accept community fraud reports
- Build a graph of connected fraud entities — mule networks, not just a blacklist
- Expose a public API for fintech integrations

**Business model:** Free public tool → credibility + data → sell risk API to Indonesian fintechs.

**Stack:** Next.js 14 + TypeScript + Supabase (PostgreSQL) + Vercel. Total cost: $0 on free tiers.

---

## 2. Repository Structure

```
jagaid/
├── src/
│   ├── types/
│   │   └── index.ts                   All shared TypeScript types
│   ├── lib/
│   │   ├── risk.ts                    Pure risk scoring (no imports, no side effects)
│   │   ├── lookup.ts                  Pure search and graph logic
│   │   ├── validators.ts              Zod schemas for all API input
│   │   ├── seed-data.ts               In-memory dev/test database (SEED_DB)
│   │   ├── db.ts                      Single DB gateway — Supabase or seed fallback
│   │   └── supabase.ts                Lazy Supabase client factories
│   ├── components/
│   │   └── App.tsx                    Main UI, 3 tabs: CEK, LAPOR, DATA
│   ├── middleware.ts                  CORS preflight (only fires when ALLOWED_ORIGIN is set)
│   └── app/
│       ├── layout.tsx                 Root layout, font, SEO metadata
│       ├── page.tsx                   Entry point (renders App)
│       ├── admin/
│       │   └── upload/
│       │       └── page.tsx           CSV upload UI at /admin/upload
│       └── api/
│           ├── check/route.ts         GET  /api/check?q=
│           ├── report/route.ts        POST /api/report
│           ├── stats/route.ts         GET  /api/stats
│           ├── e2e-seed/route.ts      POST/DELETE /api/e2e-seed (test fixtures)
│           └── admin/
│               ├── upload/route.ts    POST   /api/admin/upload
│               └── reset/route.ts     DELETE /api/admin/reset
├── tests/
│   ├── setup.ts                       Jest global setup
│   ├── unit/
│   │   ├── risk.test.ts               21 tests
│   │   ├── risk-parity.test.ts         6 tests — SQL view ↔ TS calcRisk parity
│   │   ├── lookup.test.ts             24 tests
│   │   ├── validators.test.ts         18 tests
│   │   ├── db.test.ts                 16 tests
│   │   └── supabase.test.ts            8 tests
│   ├── integration/
│   │   ├── api.test.ts                12 tests
│   │   └── routes.test.ts             43 tests
│   └── e2e/
│       ├── app.spec.ts                30 tests
│       └── global-teardown.ts         cleans e2e fixtures after suite
├── scripts/
│   ├── setup.sh                       One-command dev setup (Mac/Linux)
│   ├── seed.ts                        Push seed data to Supabase (normalized values)
│   ├── reset-db.ts                    Wipe all Supabase rows (confirmation)
│   ├── scrape-ojk.ts                  Scrape OJK → data/ojk-scraped.json
│   ├── import-ojk.ts                  Push scraped data → Supabase (deterministic IDs)
│   └── test-e2e-supabase.sh           E2E tests against test Supabase project
├── supabase/
│   └── migrations/
│       ├── 001_initial_schema.sql             Tables, indexes, triggers, base RLS, view
│       ├── 002_fix_risk_and_constraints.sql   UNIQUE(type,value), service_role-only RLS, fixed view
│       └── 003_indexes_source_dedup.sql       Value index, source/confidence, IP dedup
├── data/
│   ├── manual.csv                     CSV template for manual entry
│   └── .gitignore
├── docs/
│   ├── PROJECT_REFERENCE.md           This file
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DATA.md
│   └── DEPLOYMENT.md
├── .github/
│   └── workflows/
│       └── ci.yml                     GitHub Actions CI
├── .env.example                       Template for .env.local
├── .env.test.example                  Template for .env.test
├── .eslintrc.json
├── .gitignore
├── .prettierrc
├── CLAUDE.md                          AI assistant context
├── jest.config.ts
├── next.config.js
├── package.json
├── playwright.config.ts
├── README.md
├── tsconfig.json                      Next.js app (excludes tests)
├── tsconfig.jest.json                 Tests (includes jest types)
└── tsconfig.scripts.json              CLI scripts (CommonJS)
```

---

## 3. Architecture

### Data flow

```
┌─────────────────────────────────────────────────────────────┐
│  Browser                                                     │
│                                                              │
│  src/components/App.tsx  ("use client")                      │
│    CEK tab   → fetch("GET  /api/check?q=...")                │
│    LAPOR tab → fetch("POST /api/report")                     │
│    DATA tab  → fetch("GET  /api/stats")                      │
└──────────────────────┬──────────────────────────────────────┘
                       │  HTTP (same origin)
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Vercel — Next.js API routes (server-side)                   │
│  Reads NEXT_PUBLIC_* env vars baked in at build time         │
│                                                              │
│  src/app/api/check/route.ts    GET  /api/check               │
│  src/app/api/report/route.ts   POST /api/report              │
│  src/app/api/stats/route.ts    GET  /api/stats               │
│  src/app/api/admin/upload/     POST /api/admin/upload        │
│  src/app/api/admin/reset/      DELETE /api/admin/reset       │
│  src/app/api/e2e-seed/         POST/DELETE /api/e2e-seed     │
│                                                              │
│  All routes call → src/lib/db.ts (single DB gateway)        │
└──────────────────────┬──────────────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │                         │
          │ USE_SUPABASE=false       │ USE_SUPABASE=true
          ▼                         ▼
┌──────────────────┐   ┌────────────────────────────────────┐
│  src/lib/        │   │  Supabase PostgreSQL               │
│  seed-data.ts    │   │                                    │
│                  │   │  Tables:                           │
│  SEED_DB         │   │    entities   (fraud entities)     │
│  (in-memory)     │   │    connections (graph edges)       │
│                  │   │    reports    (fraud reports)      │
│  6 entities      │   │                                    │
│  3 reports       │   │  View:                             │
│  no network      │   │    entity_risk_summary             │
│                  │   │                                    │
│  Used by:        │   │  Used by:                          │
│  npm test        │   │    jagaid-test  (e2e testing)      │
│  npm run test:e2e│   │    jagaid-prod  (production)       │
└──────────────────┘   └────────────────────────────────────┘
```

### Three environments

| Environment  | DB mode         | Database            | How activated               |
| ------------ | --------------- | ------------------- | --------------------------- |
| Local dev    | false (default) | SEED_DB in-memory   | `npm run dev`               |
| E2E testing  | false           | SEED_DB in-memory   | `npm run test:e2e`          |
| E2E Supabase | true            | jagaid-test project | `npm run test:e2e:supabase` |
| Production   | true            | jagaid-prod project | Vercel deployment           |

### Key rules

**Rule 1: `db.ts` is the only DB entry point.**
No route, component, or script imports from `supabase.ts` or `seed-data.ts` directly.

**Rule 2: `App.tsx` only calls API routes.**
`App.tsx` is `"use client"`. It uses `fetch()` to call `/api/*`. Never imports from `lib/`. This is why Vercel env vars work — they're read server-side.

**Rule 3: `supabase.ts` exports functions, not constants.**
They throw only when called, not at import time — no build failures on fresh clones.

**Rule 4: Tests never need a live database.**
`NEXT_PUBLIC_USE_SUPABASE` is unset in all unit/integration tests. `db.ts` uses SEED_DB. All 170 unit/integration tests run with zero network calls.

**Rule 5: E2E always runs seed-fallback unless explicitly using `:supabase`.**
`playwright.config.ts` forces `USE_SUPABASE=false` and `NEXT_PUBLIC_USE_SUPABASE=false` in the webServer env when not in Supabase mode. This means `npm run test:e2e` always uses SEED_DB regardless of `.env.local`.

**Rule 6: All values are normalized.** `normalizeQuery` (in `src/lib/lookup.ts`) is applied inside Zod validators (`ReportPayloadSchema.value`, `LookupQuerySchema.q`), inside `dbSubmitReport`, and inside the admin upload route. Stored entity values therefore never contain spaces, dashes, or uppercase letters. This is what makes `dbLookup`'s `.eq("value", q)` exact match correct.

**Rule 7: Lookup is exact-match only.** `lookup.ts:matchesEntity` returns `true` only on exact equality after normalization. The Supabase path uses `.eq()`, not `.ilike()`. Substring search and SQL `%/_` wildcards are intentionally disabled.

---

## 4. Database Schema

### Tables

**`entities`**

```sql
id          text PRIMARY KEY
type        entity_type   -- 'bank_account' | 'phone' | 'ewallet' | 'domain'
value       text          -- always normalized: lowercase, no spaces, no dashes, min 1 char
bank        text          -- nullable, only for bank_account
reports     integer       -- auto-incremented by trigger, starts at 0
last_seen   date
created_at  timestamptz
-- UNIQUE (type, value)   -- added in migration 002
```

Index on `lower(trim(value))` for fast case-insensitive search; the unique constraint on `(type, value)` enables `onConflict: "type,value"` upserts in the admin importer.

**`connections`** (graph edges)

```sql
id          uuid PRIMARY KEY
from_id     text → entities.id (CASCADE DELETE)
to_id       text → entities.id (CASCADE DELETE)
created_at  timestamptz
-- UNIQUE (from_id, to_id)
-- CHECK (from_id <> to_id)
```

**`reports`**

```sql
id          text PRIMARY KEY
entity_id   text → entities.id (CASCADE DELETE)
type        scam_type     -- enum of 8 values (see validators.ts)
amount      text          -- nullable e.g. "Rp 2.500.000"
date        date
description text          -- CHECK length(trim(description)) >= 10
created_at  timestamptz
```

### View: `entity_risk_summary`

Replicates the risk formula in SQL for efficient dashboard sorting. Migration 002 brings it in line with `lib/risk.ts` exactly:

```sql
SELECT e.*,
  connection_count,
  LEAST(
    LEAST(e.reports * 4, 60)
    + LEAST(connection_count * 8, 24)
    + CASE
        WHEN e.last_seen > current_date THEN 0
        WHEN e.last_seen >= current_date - interval '30 days' THEN 15
        WHEN e.last_seen >= current_date - interval '90 days' THEN 8
        ELSE 0
      END,
    100
  ) AS risk_score
FROM entities e
```

`tests/unit/risk-parity.test.ts` enforces parity by computing the SQL formula in JS and comparing against `calcRiskScore` for a sample set including caps and edge cases (future dates, large connection counts). **If you change `lib/risk.ts`, also update the SQL view and re-run the parity test.**

### Trigger: `trg_increment_report_count`

Fires AFTER INSERT on `reports`. Increments `entities.reports` and updates `last_seen`. Ensures concurrent inserts are always consistent. This is why you seed entities with `reports: 0` — the trigger handles counting.

### RLS policies (after migration 002)

- **Reads**: public (`for select using (true)`) on `entities`, `reports`, `connections`.
- **Writes**: restricted to the Postgres `service_role` role on all three tables. The browser-exposed anon key cannot insert. All API routes that write call `supabaseAdmin()`, which uses `SUPABASE_SERVICE_ROLE_KEY` (legacy JWT or `sb_secret_*`). The base policies that allowed `with check (true)` to anyone were dropped in 002.

### Important: `connected` is not a column

The `Entity` TypeScript type has `connected: string[]` but this field does not exist in Supabase. It is assembled at query time by joining `connections`. Never try to INSERT a `connected` column.

---

## 5. API Reference

### Public endpoints

#### `GET /api/check?q=`

**Check if an entity has been reported.** Exact match only — `q` is normalized via `normalizeQuery` (trim, lowercase, strip whitespace and dashes) and compared with `.eq()`. Substring/wildcard search is intentionally disabled.

| Param | Required | Constraint                       |
| ----- | -------- | -------------------------------- |
| `q`   | Yes      | 5–200 chars before normalization |

Response (found):

```json
{
  "found": true,
  "entity": { "id", "type", "value", "bank", "reports", "connected", "last_seen" },
  "risk": {
    "score": 99,
    "label": "BAHAYA TINGGI",
    "color": "#ff2d2d",
    "breakdown": { "reportScore": 60, "networkScore": 24, "recencyScore": 15 }
  },
  "reports": [...],
  "network": [...]
}
```

Response (not found): `{ "found": false }`

Status: `200` OK, `400` query too short, `500` DB error

---

#### `POST /api/report`

**Submit a fraud report.**

Valid `type`: `bank_account` | `phone` | `ewallet` | `domain`

Valid `scam_type`: `Transfer Penipuan` | `Investasi Bodong` | `Phishing` | `COD Palsu` | `Pinjol Ilegal` | `Belanja Online` | `Lowongan Kerja Palsu` | `Lainnya`

```json
{
  "type": "bank_account",
  "value": "1234567890",
  "bank": "BRI",
  "scam_type": "Transfer Penipuan",
  "amount": "Rp 2.500.000",
  "description": "min 10 chars"
}
```

Status: `201` created, `400` bad JSON, `422` validation failed, `500` DB error

---

#### `GET /api/stats`

**Dashboard statistics.**

```json
{
  "stats": { "totalReports", "totalEntities", "highRiskCount", "bankCount" },
  "topEntities": [ /* up to 5, sorted by risk_score desc */ ]
}
```

---

### Admin endpoints (require `x-admin-key` header)

#### `POST /api/admin/upload`

Bulk import entities from CSV.
Send as `multipart/form-data` with field `file`, or raw CSV body.

Response: `{ "success": true, "summary": { "total_rows", "inserted", "skipped" } }`

Status: `200` OK, `400` empty/bad CSV, `401` wrong key, `500` DB error

---

#### `DELETE /api/admin/reset`

Wipe all rows in FK-safe order: reports → connections → entities.

Response: `{ "success": true, "deleted": { "reports", "connections", "entities" } }`

Status: `200` OK, `401` wrong key, `500` DB error

---

### Test-only endpoint

#### `POST /api/e2e-seed` (header: `x-e2e-key`)

Insert known test fixtures for e2e tests. Called by the Playwright runner. In seed-fallback mode this is a no-op. In Supabase mode it inserts entities `e2e_1`–`e2e_5`, 3 connections, and 17 reports — the `1234567890` entity is guaranteed to score 99 (BAHAYA TINGGI).

#### `DELETE /api/e2e-seed` (header: `x-e2e-key`)

Remove e2e test fixtures (rows with id starting `e2e_`). Called by `global-teardown.ts` after the suite.

The key is **always sent in the `x-e2e-key` request header** — there is no query-string fallback. This keeps the secret out of server access logs.

---

## 6. Environment Variables

### `.env.local` — local dev and Vercel production

| Variable                        | Used by                           | Notes                                                                                                                                 |
| ------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `supabase.ts`                     | From Supabase dashboard → Settings → API                                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase.ts`                     | Public — accepts legacy `anon` JWT or new `sb_publishable_*` opaque token                                                             |
| `SUPABASE_SERVICE_ROLE_KEY`     | `supabase.ts` admin               | **Server-only** — accepts legacy `service_role` JWT or `sb_secret_*` opaque token. After migration 002, the only key allowed to write |
| `USE_SUPABASE`                  | `db.ts` (server-only)             | Runtime switch — set in `.env.test`, read at request time, no rebuild                                                                 |
| `NEXT_PUBLIC_USE_SUPABASE`      | `db.ts` (build-time)              | Baked into bundle at build — set in Vercel env vars for production                                                                    |
| `ADMIN_UPLOAD_KEY`              | admin routes                      | Sent via `x-admin-key` header — protects `/admin/upload` and `/api/admin/*`                                                           |
| `E2E_SEED_KEY`                  | `e2e-seed` route                  | Sent via `x-e2e-key` header — only needed when running `test:e2e:supabase`                                                            |
| `ALLOWED_ORIGIN`                | `next.config.js`, `middleware.ts` | Optional. Single cross-origin domain for `/api/*`. Unset = same-origin only                                                           |
| `NEXT_PUBLIC_APP_URL`           | `App.tsx`                         | Optional. Fallback origin for the WhatsApp share text                                                                                 |
| `SCRAPER_CONTACT_EMAIL`         | `scrape-ojk.ts`                   | Optional. Embedded in scraper User-Agent                                                                                              |

Generate secrets: `openssl rand -hex 32`

### `.env.test` — test Supabase project

Same variables but pointing at `jagaid-test` Supabase project. Never use production credentials. Both `.env.local` and `.env.test` are in `.gitignore`.

### Vercel

Set all variables under Project → Settings → Environment Variables → **Production**.
After any change → **redeploy** (Vercel never hot-reloads env vars).

---

## 7. npm Scripts

```bash
# Development
npm run dev              Start dev server on :3000
npm run build            Production build

# Linting
npx eslint .
npx prettier --write .   Prettier fix
npx prettier --check .   Prettier check (used in CI)

# Testing — unit and integration (no browser, no DB)
npm test                 170 tests, runs instantly
npm run test:unit        Alias for npm test
npm run test:watch       Watch mode
npm run test:coverage    With coverage report, 70% threshold enforced

# Testing — e2e browser
npm run test:e2e         Playwright, seed-fallback mode (needs playwright install)
npm run test:e2e:ui      Playwright interactive UI
npm run test:e2e:supabase  Against real test Supabase DB (needs .env.test)

# Testing — everything
npm run test:all         unit + integration + e2e (seed-fallback)
npm run test:ci          same as test:all — alias used by CI pipeline

# Database scripts (run locally, connect to Supabase over internet)
npm run db:seed          Push SEED_DB data to Supabase
npm run db:seed -- --test  Push SEED_DB data to .env.test Supabase
npm run reset:db         Wipe all rows (confirmation prompt)
npm run reset:db -- --test Wipe all rows in .env.test Supabase
npm run scrape           Alias for scrape:ojk
npm run scrape:ojk       Scrape OJK → data/ojk-scraped.json
npm run import:ojk       Push scraped data → Supabase (idempotent)
npm run import:ojk -- --test  Push scraped/manual data to .env.test Supabase
npm run data:refresh     scrape:ojk + import:ojk in sequence
```

---

## 8. Test Environments

### `npm test` — unit and integration

Runs entirely in-memory. No browser, no DB, no network needed. Always works.

What is covered:

- `lib/risk.ts` — all scoring functions, edge cases, caps
- `lib/lookup.ts` — search, normalisation, graph traversal
- `lib/validators.ts` — all valid/invalid inputs for every schema
- `lib/supabase.ts` — lazy init, env var errors, no throw at import
- `lib/db.ts` — all functions in seed-fallback mode
- All API route handler logic
- Admin auth guard
- CSV parser (quotes, CRLF, missing columns)
- Risk score cross-validation between routes

### `npm run test:e2e` — Playwright, seed-fallback

Playwright starts the dev server automatically with `NEXT_PUBLIC_USE_SUPABASE=false`. Tests run against SEED_DB. No Supabase needed.

One-time setup:

```bash
npx playwright install chromium
```

Then just:

```bash
npm run test:e2e
```

### `npm run test:e2e:supabase` — Playwright, real DB

Tests the actual Supabase connection. Requires a separate test project.

Setup (one-time):

1. Create `jagaid-test` project at supabase.com
2. Run all migrations in its SQL editor in order:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_fix_risk_and_constraints.sql`
   - `supabase/migrations/003_indexes_source_dedup.sql`
3. Copy `.env.test.example` → `.env.test`
4. Fill in with `jagaid-test` credentials (NOT production)

Then run any time:

```bash
npm run test:e2e:supabase
```

`scripts/setup.sh` also creates `.env.test` from `.env.test.example` when missing. After filling it in, you can opt into this real-DB smoke test during setup with:

```bash
RUN_SUPABASE_E2E=1 bash scripts/setup.sh
```

What happens:

- Script loads `.env.test` and validates credentials aren't production
- Dev server starts pointed at `jagaid-test`
- Script calls `DELETE /api/e2e-seed` (with `x-e2e-key` header) to wipe any leftover fixtures
- Script calls `POST /api/e2e-seed` to insert known fixtures
- Tests run against predictable data
- `global-teardown.ts` calls `DELETE /api/e2e-seed` to clean up

### E2E fixture guarantees

The e2e seed inserts `e2e_1` (`1234567890` bank account) so that:

- `1234567890` → exists, **score = 99** (BAHAYA TINGGI), has 3 network connections
- `0000000000` → does not exist, returns `found: false`
- Dashboard → has entities to display
- Admin page → all UI elements present

Score breakdown (with default 5-day-old `last_seen`):

- 15 reports → `reportScore = min(15 × 4, 60) = 60`
- 3 connections → `networkScore = min(3 × 8, 24) = 24`
- `recencyScore = 15` (within 30 days)
- Total: `min(60 + 24 + 15, 100) = 99`

Even with `recencyScore = 0` (worst case), the score still reaches `60 + 24 = 84`, which is solidly inside BAHAYA TINGGI (≥ 80). The 3 connections are intentional — 2 connections would only contribute 16 points, dropping the worst case to 76 (MENCURIGAKAN).

### `npm run test:all` — everything

Runs `npm test` then `npm run test:e2e`. Requires Playwright browsers installed.

---

## 9. Data Pipeline

### Sources

| Source                    | Method  | Quality    | Notes                                  |
| ------------------------- | ------- | ---------- | -------------------------------------- |
| OJK Investor Alert Portal | Scraper | High       | Often 403 — use CSV fallback           |
| Satgas Waspada Investasi  | Scraper | Medium     | Regex extraction has false positives   |
| PatroliSiber.id           | Scraper | Medium     | Variable structure                     |
| `data/manual.csv`         | Manual  | Controlled | Always works — primary production path |

### Manual CSV format

```csv
type,value,bank,scam_type
bank_account,1234567890,BRI,Transfer Penipuan
phone,08123456789,,Phishing
domain,investasi-cepat.com,,Investasi Bodong
ewallet,GoPay:08123456789,,Transfer Penipuan
```

Rules:

- Header row required (case-insensitive: `Type,Value,...` is accepted)
- `bank` and `scam_type` may be empty (leave the comma)
- Values are normalized on import (trim, lowercase, strip URL protocol, leading `www.`, path/query/hash, whitespace, and `-`). The example `https://www.investasi-cepat.com/path` stores as `investasicepat.com`; `GoPay:08123456789` stores as `gopay:08123456789`
- Rows with normalized value < 5 chars are filtered
- Quoted values, embedded commas, CRLF, and irregular column counts are handled by `csv-parse/sync`

### Full reset and fresh import

```bash
npm run reset:db         # type "yes" — wipes all rows
npm run scrape:ojk       # scrapes all sources + reads data/manual.csv
npm run import:ojk       # pushes to Supabase
```

For `.env.test`, add `-- --test` to DB scripts:

```bash
npm run reset:db -- --test
npm run import:ojk -- --test
```

### Add new data without wiping

```bash
npm run scrape:ojk
npm run import:ojk       # safe to re-run — ignore-duplicates
```

If `data/ojk-scraped.json` is absent, `npm run import:ojk` imports `data/manual.csv` directly.

### Idempotency

All import operations are safe to re-run. `ignore-duplicates` prevents double-counting. If the report trigger fires multiple times, the final `PATCH` step in `seed.ts` recalculates from actual counts.

---

## 10. Deployment

### First deployment

**Step 1 — Supabase production project**

1. Create project at supabase.com
2. SQL Editor → run `supabase/migrations/001_initial_schema.sql`
3. SQL Editor → run `supabase/migrations/002_fix_risk_and_constraints.sql` (must be on a clean entities table — empty or pre-deduped)
4. SQL Editor → run `supabase/migrations/003_indexes_source_dedup.sql`

**Step 2 — Vercel**

1. Import repo at vercel.com
2. Add environment variables (see section 6)
3. Deploy

**Step 3 — Verify connection**
Visit `https://your-app.vercel.app/api/check?q=test`

- Returns `{ "found": false }` → connected to Supabase, empty DB
- Returns seed data → `NEXT_PUBLIC_USE_SUPABASE` not `"true"` — check and redeploy

**Step 4 — Load initial data**
Option A — via browser:

1. Go to `https://your-app.vercel.app/admin/upload`
2. Enter `ADMIN_UPLOAD_KEY`
3. Reset DB (clears any stale data)
4. Upload your CSV

Option B — via scripts:

```bash
npm run reset:db
npm run scrape:ojk   # or fill data/manual.csv
npm run import:ojk
```

### Troubleshooting deployments

**App shows seed data on Vercel**
`NEXT_PUBLIC_USE_SUPABASE` is not `"true"` in Vercel env vars for Production, or the deployment predates the env var being set. Check Vercel → Settings → Environment Variables → ensure it's set for Production. Redeploy.

**`/api/check` returns 500**
Check Vercel function logs. Usually: wrong Supabase URL, wrong key, or schema not applied.

**Admin upload returns 401**
`x-admin-key` header doesn't match `ADMIN_UPLOAD_KEY`. Case-sensitive exact match.

**Report count doubles after re-seeding**
The DB trigger fires on every report insert. The seed script uses `ignore-duplicates` to prevent this. If it happens, run the `reset:db` then re-import.

### CI (GitHub Actions)

`.github/workflows/ci.yml` runs on push to main and on PRs:

1. `tsc --noEmit` — type check
2. `npm run lint` — ESLint
3. `npm run format:check` — Prettier
4. `npm run test:coverage` — unit + integration with 70% threshold
5. (separate job, after tests pass) `npm run test:e2e` — Playwright Chromium

---

## 11. Configuration Files

### `tsconfig.json` — Next.js app

- `include`: `src/**` only — tests explicitly excluded
- No jest types — prevents `beforeAll not found` in `next build`
- `moduleResolution: bundler` — required for Next.js 14

### `tsconfig.jest.json` — test files

- `include`: `src/**` + `tests/**`
- `types: ["jest", "node"]` — provides `beforeAll`, `expect`, etc.
- `jsx: "react"` — for React component tests
- Used by `jest.config.ts` transform

### `tsconfig.scripts.json` — CLI scripts

- `module: commonjs`, `moduleResolution: node` — ts-node requirement
- `noEmit: false`, `outDir: dist-scripts`
- No Next.js-specific settings
- `include`: `scripts/**`, `src/lib/**`, `src/types/**`

### `jest.config.ts`

- `setupFilesAfterEnv` (not `setupFiles`) for `@testing-library/jest-dom`
- `moduleNameMapper: { "@/*": "<rootDir>/src/$1" }` — path aliases
- Transform uses `tsconfig.jest.json`
- `coverageThreshold`: 70% on all metrics

### `playwright.config.ts`

- `globalTeardown`: cleans e2e test fixtures after suite
- No `globalSetup` — seeding happens in `beforeAll` inside the spec after server is ready
- `webServer.reuseExistingServer: false` — always restart so env var is applied
- When `USE_SUPABASE !== "true"`: forces `NEXT_PUBLIC_USE_SUPABASE=false` in webServer env

### `.eslintrc.json`

- Extends `next/core-web-vitals`
- `no-console: warn` (allows `console.error` and `console.warn`)

### `.prettierrc`

- `semi: true`, `singleQuote: false`, `tabWidth: 2`
- `trailingComma: "es5"`, `printWidth: 90`

### `next.config.js`

- `reactStrictMode: true`, `poweredByHeader: false`
- Security headers on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Content-Security-Policy` (CSP relaxes `'unsafe-eval'` and `ws://localhost:*` in dev only, for HMR)
- CORS headers on `/api/*` are **opt-in** via `ALLOWED_ORIGIN` env var. When set, response headers carry `Access-Control-Allow-Origin`, `Allow-Methods` (`GET, POST, DELETE, OPTIONS`), `Allow-Headers` (`Content-Type, x-admin-key, x-e2e-key`), and `Vary: Origin`. When unset, no CORS headers are emitted (same-origin only — the safe default)

### `src/middleware.ts`

- Matches `/api/:path*`. Only handles `OPTIONS` preflight requests. Other methods pass through.
- If `ALLOWED_ORIGIN` is unset → returns 405 on preflight (cross-origin not configured).
- If `ALLOWED_ORIGIN` is set → 204 with full CORS headers when `Origin` matches; 403 otherwise.

---

## 12. Risk Scoring

### Formula

```
reportScore  = min(reports × 4,          60)   capped at 60
networkScore = min(connections × 8,      24)   capped at 24
recencyScore = 0   if last_seen is in the future (clock skew safety)
             = 15  if last_seen within 30 days
             =  8  if last_seen within 90 days
             =  0  if older than 90 days

score = min(reportScore + networkScore + recencyScore, 100)
```

### Labels

| Score  | Label           | Colour    |
| ------ | --------------- | --------- |
| 80–100 | `BAHAYA TINGGI` | `#ff2d2d` |
| 50–79  | `MENCURIGAKAN`  | `#ff9500` |
| 20–49  | `WASPADA`       | `#ffd60a` |
| 0–19   | `AMAN`          | `#30d158` |

### Guaranteed BAHAYA TINGGI

With 2 connections: max score without recency = 60 + 16 = **76** (MENCURIGAKAN).
With 3 connections: max score without recency = 60 + 24 = **84** (BAHAYA TINGGI ✓).

Seed data and e2e fixtures always use ≥ 3 connections on the primary test entity `1234567890` so tests pass regardless of when `last_seen` was.

### Where scoring runs

`lib/risk.ts` is pure — no imports, no async, no side effects. Used in:

- Unit tests (never touches network)
- API responses (server-side via `db.ts`)
- Client-side dashboard sorting (App.tsx recomputes from real `connected[]` populated by `dbGetTopEntities`)
- `entity_risk_summary` SQL view (replicates formula for DB-level queries)

**The SQL view (in migration 002) and `lib/risk.ts` must stay in sync.** `tests/unit/risk-parity.test.ts` fails on drift. If you change the formula, update both and update the parity test samples to cover the new behaviour.

---

## 13. Common Issues and Fixes

**`beforeAll is not defined` in build**
Tests included in `tsconfig.json`. Move them to `tsconfig.jest.json`. Exclude `tests/` from `tsconfig.json`.

**`Missing NEXT_PUBLIC_SUPABASE_URL` in build**
`supabase.ts` has a module-level constant. Must be a lazy function — only throw when called.

**`Property 'id' does not exist on type 'never'`**
Type intersection like `Entity & { connected?: never }` resolves to `never`. Use `as unknown as Entity`.

**jest not found**
Run via `node node_modules/jest/bin/jest.js` not `npx jest`. The sandbox may not have global npx.

**npm install fails with ENOTEMPTY**
Use `python3 -c "import shutil; shutil.rmtree('node_modules')"` then reinstall.

**OJK scraper returns 0 entities**
OJK blocks requests (403). Fill `data/manual.csv` and run `npm run import:ojk` directly if `data/ojk-scraped.json` is absent, or run `npm run scrape:ojk` first if you want a generated JSON artifact to review.

**App shows seed data on Vercel after setting env vars**
Must redeploy after adding/changing env vars. Vercel never hot-reloads. Go to Deployments → latest → Redeploy.

**Admin upload returns 401**
`x-admin-key` header doesn't match `ADMIN_UPLOAD_KEY`. Exact, case-sensitive match.

**E2E tests fail with BAHAYA TINGGI not found**
Entity has fewer than 3 connections. With ≤ 2 connections, score without recency bonus is ≤ 76 (MENCURIGAKAN). Add a 3rd connection or ensure `last_seen` is recent.

**E2E `globalSetup` seed fails silently**
`globalSetup` runs before `webServer` starts. Fetch to `/api/e2e-seed` fails. Solution: use `beforeAll` inside the spec (already done in `app.spec.ts`).

**`setupFiles` vs `setupFilesAfterEnv`**
Use `setupFilesAfterEnv` for `@testing-library/jest-dom`. `setupFiles` runs before the test framework and can't access jest globals like `expect`.

**E2E tests use text selectors that break on content changes**
All selectors must use `data-testid` attributes. Never use `getByText` for structural elements.

**Lookup returns "not found" for an entity I know is there**
Did you store a value with spaces, dashes, or uppercase before migration 002 / the normalization rollout? Stored values must match `normalizeQuery(value)`. Run `npm run reset:db && npm run db:seed` to re-seed normalized, or update the row manually: `UPDATE entities SET value = lower(replace(replace(trim(value), ' ', ''), '-', ''))`.

**Migration 002 fails with "duplicate key value violates unique constraint"**
You have duplicate `(type, value)` rows. Run `npm run reset:db` first, then re-apply all migrations, then re-seed.

**`/api/report` works locally but returns 500 in production after migration 002**
The route must be using `supabaseAdmin()` (service-role key). Check `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel and the deployment is fresh. The browser anon key cannot insert after migration 002's RLS lockdown.

**Cross-origin fetch from another domain returns CORS error**
`ALLOWED_ORIGIN` isn't set, or it's set to a different domain than the caller. Set `ALLOWED_ORIGIN=https://your-caller-domain.com` in Vercel and redeploy.

**Risk parity test fails after editing risk.ts**
The active SQL view in `supabase/migrations/003_indexes_source_dedup.sql` no longer matches the TS formula. Update the view's `LEAST(...)` expression in lock-step with `risk.ts`, re-apply the migration to your test/prod DBs, and update sample cases in `tests/unit/risk-parity.test.ts` if the change affects them.

---

## 14. Decisions Log

### Why explicit `NEXT_PUBLIC_USE_SUPABASE` flag

Could auto-detect from URL presence. We don't because `NEXT_PUBLIC_` vars are baked into the bundle at build time. An explicit flag makes intent clear and lets you build once, deploy to multiple environments.

### Why Supabase over other hosted Postgres options

Free tier includes PostgreSQL + REST API + Row Level Security + realtime. The REST API lets scripts push data with `fetch()` — no database driver needed. RLS is a security layer without application-level auth.

### Why no CSS framework

The dark terminal aesthetic needs precise control. Adding Tailwind or another framework adds a build step and wouldn't improve what exists. Trade-off: verbose inline styles — acceptable for a single-component UI.

### Why `data-testid` over text selectors in E2E

Text changes with wording tweaks or language changes. CSS classes change with styling. `data-testid` is stable — explicit test-relevant intent that survives content and style changes.

### Why admin upload uses a secret key instead of Supabase Auth

Supabase Auth requires email/password setup, middleware, protected routes, session management. For a single operator uploading data occasionally, a shared secret is proportionate and simpler. Upgrade path to proper auth is straightforward when needed.

### Why E2E always runs seed-fallback unless explicitly using `:supabase`

Running e2e against production DB is dangerous — tests submit reports, which would pollute real data. The seed-fallback mode makes `npm run test:e2e` safe to run anytime without side effects. The `:supabase` variant is explicit opt-in.

### Why OJK data goes through CSV not direct DB import

OJK returns 403 to automated requests. A CSV workflow always works regardless of OJK's bot-blocking. Scrapers are an optimistic layer on top of a reliable CSV fallback.

### Why 3 connections are required for guaranteed BAHAYA TINGGI

With the capped formula (reportScore max 60, networkScore max 24), and recencyScore possibly 0 (entity not seen recently): 60 + 16 = 76 < 80 with 2 connections. 60 + 24 = 84 >= 80 with 3 connections. E2E tests must be deterministic regardless of when they run.
