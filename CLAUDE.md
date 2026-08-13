# JagaID — CLAUDE.md

Complete context for working on this codebase. Read this before touching anything.

---

## What this project is

JagaID is an anti-fraud intelligence platform for Indonesia. Anyone can check whether a bank account, phone number, e-wallet, or domain has been reported for fraud — and submit new reports. Behind the scenes it builds a graph of connected fraud entities, not just a blacklist. The long-term goal is to sell risk intelligence via API to Indonesian fintechs.

---

## Tech stack

| Layer      | Choice                                 |
| ---------- | -------------------------------------- |
| Framework  | Next.js 14 (App Router)                |
| Language   | TypeScript (strict)                    |
| Database   | Supabase (PostgreSQL)                  |
| Validation | Zod                                    |
| Unit tests | Jest + ts-jest                         |
| E2E tests  | Playwright                             |
| Deployment | Vercel                                 |
| Styling    | Inline React styles (no CSS framework) |

---

## Project structure

```
src/
  types/index.ts              all shared TypeScript types (Entity, EntityWithRisk, Report, RiskResult, etc.)
  lib/
    risk.ts                   pure risk scoring functions — no imports, no side effects
    lookup.ts                 pure search/graph logic against a Database object
    validators.ts             Zod schemas for all API input validation
    seed-data.ts              in-memory dev/test database (SEED_DB)
    db.ts                     ONLY place that touches the DB — Supabase or SEED_DB
    supabase.ts               lazy Supabase client factories (supabase(), supabaseAdmin())
    auth.ts                   constant-time secret comparison (admin/e2e keys)
    rate-limit.ts             in-memory token-bucket rate limiter
    client-ip.ts              IP extraction + SHA-256 hashing (for dedup, never store raw IPs)
  components/
    App.tsx                   main UI — 3 tabs: CEK, LAPOR, DATA — calls API routes only
  middleware.ts               CSP nonce per request + CORS preflight
  app/
    layout.tsx                root layout, next/font (self-hosts Space Mono), SEO metadata
    page.tsx                  entry point, renders App (server component)
    api/
      check/route.ts          GET  /api/check?q=    (rate-limited 60/min/IP)
      report/route.ts         POST /api/report      (rate-limited 5/hr/IP+entity, dedup via IP hash)
      stats/route.ts          GET  /api/stats
      e2e-seed/route.ts       POST/DELETE /api/e2e-seed (test fixtures, key-guarded)
      admin/
        upload/route.ts       POST   /api/admin/upload (CSV → Supabase)
        reset/route.ts        DELETE /api/admin/reset (wipe all rows)
    admin/
      upload/page.tsx         drag-drop CSV upload UI at /admin/upload

tests/
  setup.ts                    Jest global setup (@testing-library/jest-dom)
  unit/
    risk.test.ts              21 tests
    risk-parity.test.ts        6 tests — SQL view formula must match lib/risk.ts
    lookup.test.ts            29 tests (URL normalisation cases added in 2026-05)
    validators.test.ts        20 tests (bank/amount max-length cases)
    db.test.ts                16 tests — all db.ts functions in seed-fallback mode
    supabase.test.ts           8 tests — lazy init, env var errors
    rate-limit.test.ts         7 tests — token-bucket counter, window reset, key isolation
    auth.test.ts               8 tests — constant-time comparison
  integration/
    api.test.ts               12 tests — /api/check and /api/report handler logic
    routes.test.ts            43 tests — all routes, admin auth, CSV parser
  e2e/
    app.spec.ts               30 tests — full browser flows, all tabs + admin page
    global-teardown.ts        cleans e2e fixtures from Supabase after suite

scripts/
  setup.sh                    one-command dev setup (Mac/Linux)
  seed.ts                     push SEED_DB data to Supabase
  reset-db.ts                 wipe all rows from Supabase (confirmation prompt)
  scrape-ojk.ts               scrape OJK public data → data/ojk-scraped.json
  import-ojk.ts               push ojk-scraped.json → Supabase in batches
  test-e2e-supabase.sh        run e2e tests against the test Supabase project

supabase/migrations/
  001_initial_schema.sql              full schema with triggers, RLS, indexes, view
  002_fix_risk_and_constraints.sql    UNIQUE(type,value), service_role-only RLS, fixed view
  003_indexes_source_dedup.sql        idx_entities_value, source/confidence cols, IP-hash dedup

data/
  manual.csv                  CSV template for manual data entry
  .gitignore                  ignores ojk-scraped.json (may contain PII)

.env.example                  template for .env.local (dev + prod)
.env.test.example             template for .env.test (test Supabase project)
```

---

## Architecture diagram

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

---

## Key design decisions

### `db.ts` is the only place that touches the database

All API routes call `dbLookup`, `dbSubmitReport`, `dbGetStats`, `dbGetTopEntities`, or `dbGetDatabase`. They never import from `seed-data.ts` or `supabase.ts` directly. If you need a new DB operation, add it to `db.ts` first.

### `App.tsx` calls API routes — never the DB directly

`App.tsx` is `"use client"`. It uses `fetch("/api/check")`, `fetch("/api/report")`, and `fetch("/api/stats")`. It never imports from `lib/`. This is the only way Vercel environment variables work — they are read server-side in the API routes, not in the browser bundle.

### Seed fallback is controlled by one env var

`NEXT_PUBLIC_USE_SUPABASE=true` → Supabase. Anything else → SEED_DB. This means 148 unit/integration tests run with zero network calls, zero DB connections.

### `supabase.ts` exports functions, not constants

`supabase()` and `supabaseAdmin()` throw only when called, not at import time. This prevents `next build` failures in CI or on fresh clones where env vars aren't set.

### Risk score formula

```
reportScore  = min(reports × 4,          60)   max 60
networkScore = min(connections × 8,      24)   max 24
recencyScore = 0  if last_seen is in the future (clock skew safety)
             = 15 if last_seen < 30 days
             =  8 if last_seen < 90 days
             =  0 if older

score = min(reportScore + networkScore + recencyScore, 100)

BAHAYA TINGGI  >= 80
MENCURIGAKAN   >= 50
WASPADA        >= 20
AMAN            < 20
```

**Single source of truth:** the SQL view `entity_risk_summary` (in migration 002) mirrors this formula exactly. `tests/unit/risk-parity.test.ts` enforces parity — if you change one, change the other.

**Important:** With only 2 connections, max score without recency = 60+16 = 76 (MENCURIGAKAN). Need **3 connections** to guarantee BAHAYA TINGGI (60+24=84) even when recency=0. Seed data and e2e fixtures have 3 connections on the primary test entity, so its actual score is 99 (60 reports + 24 network + 15 recency).

### Lookup is exact-match only

`src/lib/lookup.ts:matchesEntity` returns true only when `normalizeQuery(entity.value) === normalizeQuery(query)`. The Supabase path uses `.eq("value", q)`, not `.ilike("%q%")`. Substring/wildcard matching is **disabled** — for an anti-fraud lookup tool, "did the user type this exact account?" is the only safe question. `%` and `_` in user input are treated as literal characters, not SQL wildcards.

### Values are normalized everywhere

`normalizeQuery(s)` (in `src/lib/lookup.ts`) trims, lowercases, strips URL prefix (`http(s)://`, leading `www.`), strips path/query/hash, then strips whitespace and `-`. Applied at three boundaries:

1. **Validators** (`ReportPayloadSchema.value`, `LookupQuerySchema.q`) via `.transform(normalizeQuery)` — every API request comes through normalized.
2. **`db.ts` writes** — `dbSubmitReport` stores values normalized.
3. **Admin upload** (`api/admin/upload/route.ts`) — CSV rows normalized before insert.

Stored values therefore never contain spaces, dashes, uppercase, protocol, or paths. The UI can still display the original form (e.g. example badge `investasi-cepat.com`) because clicking it triggers a search that normalizes the value before lookup. Pasting `https://www.investasi-cepat.com/path?ref=foo` works too.

### Risk is computed on the server, not the client

The `/api/check` and `/api/stats` responses include the precomputed `risk` object on every entity surface (main entity, network neighbours, top-N dashboard). The client never imports `lib/risk.ts` — the only reason it would have to is to compute risk for entities the API returned without one, and we no longer have that case. Single source of truth + smaller browser bundle. The Supabase path reads `risk_score` directly from the `entity_risk_summary` view, then rebuilds the structured `RiskResult` (label/color/breakdown) using `calcRisk` server-side; parity with the SQL view is enforced by `tests/unit/risk-parity.test.ts`.

### `connected` is not a Supabase column

The `Entity` type has `connected: string[]` but this is assembled at query time from the `connections` table. Never insert a `connected` column into Supabase. Network neighbours returned via the risk view get `connected: []` because the client only reads their precomputed `risk` field — the IDs aren't needed.

### DB trigger maintains report counts

`INSERT INTO reports` auto-increments `entities.reports` via `trg_increment_report_count`. Seed with `reports: 0`, insert reports, then PATCH to recalculate if re-seeding.

**Important:** the admin upload route uses `upsert(..., { ignoreDuplicates: true })` — never `false` — because merging would silently overwrite `reports: 0` on existing rows, destroying accumulated counts. New report rows still get inserted for both new and pre-existing entities, so the trigger handles the bump correctly.

### Source and confidence on every row

Every entity and every report carries:

- `source` — `community` (default), `admin`, `ojk-alert`, `ojk-swi`, `patrolisiber`, `manual-csv`, `scrape`
- `confidence` — 0–100; community submissions are 100, admin CSV imports 90, OJK alert portal 60, OJK SWI body-text extraction 30, etc.

The scraper (`scripts/scrape-ojk.ts`) tags rows by extraction method. The OJK SWI press-release path used to flat-match `\d{10,16}` against arbitrary body text and pick up dates/IDs as fake bank accounts — `extractBankAccountsWithContext` now requires a banking keyword (rekening, a.n., bank name) within ~80 chars of the digit run, dropping confidence to 30 even for matches.

### Rate limiting and submission dedup

Two layers of defence on `/api/report` (the abuse target — every report nudges the risk score up):

1. **In-memory rate limit** (`lib/rate-limit.ts`) — token-bucket keyed by `report:${ip}:${normalised_value}`. 5 reports per IP per entity per hour. Cheap to reject; doesn't even talk to the DB. **Limitation:** Vercel serverless invocations don't share memory, so a determined attacker could hit different cold instances. Swap to Upstash Redis for hard limits.

2. **DB-side dedup index** (`migration 003`) — partial unique index on `(entity_id, submitter_ip_hash, date)`. The IP is SHA-256 hashed with a server-side salt before storage; raw IPs are never persisted. A duplicate insert raises Postgres error `23505`, which `dbSubmitReport` rethrows as `DuplicateReportError`, and the route converts to HTTP 429.

`/api/check` is also rate-limited at 60/min/IP. Both routes set `X-RateLimit-*` and `Retry-After` headers.

### Three environments

```
Local dev     NEXT_PUBLIC_USE_SUPABASE=false   SEED_DB in-memory, instant
E2E / Staging NEXT_PUBLIC_USE_SUPABASE=true    Supabase TEST project
Production    NEXT_PUBLIC_USE_SUPABASE=true    Supabase PROD project
```

### Security headers and CSP nonces

`next.config.js` still ships these static headers on every response:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`

**CSP is set per-request by `src/middleware.ts`**, not statically. Each HTML response gets a fresh nonce; the policy is `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`. This replaces the previous `'unsafe-inline'` (which made the script-src directive cosmetic). Next.js auto-applies the nonce to its own inline scripts when the request carries the `x-nonce` header that middleware sets.

`layout.tsx` calls `headers()` to opt the layout into dynamic rendering — without it, a static pre-render would freeze a single nonce at build time.

`connect-src` is `'self'` only (and `ws://localhost:*` in dev). The browser never talks to Supabase directly — all DB access is server-side. Fonts are self-hosted via `next/font/google`, so `font-src` needs only `'self'`.

CORS for `/api/*` is **opt-in** via `ALLOWED_ORIGIN`:

- If unset → no `Access-Control-Allow-Origin` headers; only same-origin requests work (the desired default).
- If set (e.g. `https://jagaid.app`) → headers and `src/middleware.ts` allow that single origin to send `OPTIONS` preflight + `GET/POST/DELETE` with `Content-Type`, `x-admin-key`, `x-e2e-key`.

### Constant-time auth

Admin and e2e key comparisons use `lib/auth.ts:safeEqual` (wraps `crypto.timingSafeEqual`). A naive `a === b` short-circuits on the first differing character, leaking the matched prefix length via response timing. Length mismatches are also handled in constant time.

### Fonts: self-hosted via next/font

`layout.tsx` uses `Space_Mono` from `next/font/google` with `variable: "--font-mono"`. The font is fetched once at build time and self-hosted from `/_next/static/`. Inline styles in `App.tsx` and `admin/upload/page.tsx` reference `var(--font-mono)`, not the literal family name. **Build requires network access** to `fonts.googleapis.com` the first time (Next caches afterward) — Vercel/CI builds are fine.

---

## Environment variables

### `.env.local` — local development and production

| Variable                        | Used by                           | Notes                                                                                                                |
| ------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | `supabase.ts`                     | Project URL from Supabase dashboard                                                                                  |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `supabase.ts`                     | Public key — accepts legacy `anon` JWT or new `sb_publishable_*` opaque token                                        |
| `SUPABASE_SERVICE_ROLE_KEY`     | `supabase.ts` admin               | Server-only — accepts legacy `service_role` JWT or new `sb_secret_*` opaque token. Never expose to browser           |
| `USE_SUPABASE`                  | `db.ts` (server-only)             | Runtime switch — set in `.env.test` for local e2e, no rebuild needed                                                 |
| `NEXT_PUBLIC_USE_SUPABASE`      | `db.ts` (build-time)              | Baked into bundle at build — set in Vercel for production                                                            |
| `ADMIN_UPLOAD_KEY`              | admin routes                      | Protects `/admin/upload` and `/api/admin/*` (sent via `x-admin-key` header). Compared with constant-time `safeEqual` |
| `E2E_SEED_KEY`                  | `e2e-seed` route                  | Used by e2e to seed test fixtures (sent via `x-e2e-key` header)                                                      |
| `ALLOWED_ORIGIN`                | `next.config.js`, `middleware.ts` | Production CORS origin (e.g. `https://jagaid.app`). If unset, API stays same-origin only                             |
| `NEXT_PUBLIC_APP_URL`           | `App.tsx` (WhatsApp share)        | Fallback origin for share text when `window.location.origin` isn't available (SSR/share link)                        |
| `IP_HASH_SALT`                  | `lib/client-ip.ts`                | Server-side salt for SHA-256 hashing of submitter IPs. Set in prod; fallback works in dev                            |

### `.env.test` — test Supabase project only

Same variables as above but pointing at the `jagaid-test` Supabase project. Never use production credentials in `.env.test`. See README for setup steps.

---

## npm scripts

```bash
# Development
npm run dev                   Start dev server :3000
npm run build                 Production build (run before deploying)

# Testing
npm test                      Unit + integration (170 tests, no browser/DB needed)
npm run test:unit             Same as npm test, explicit alias
npm run test:watch            Watch mode
npm run test:coverage         Coverage report (70% threshold enforced)
npm run test:e2e              E2E browser tests, seed-fallback mode
npm run test:e2e:ui           E2E interactive Playwright UI
npm run test:e2e:supabase     E2E against real test Supabase DB (needs .env.test)
npm run test:all              unit + integration + e2e (seed-fallback)
npm run test:ci               same as test:all — alias used by CI pipeline

# Database (all run locally, connect to Supabase over internet)
npm run db:seed               Push SEED_DB data to Supabase
npm run db:seed -- --test     Push SEED_DB data to .env.test Supabase
npm run reset:db              Wipe all rows (confirmation prompt)
npm run reset:db -- --test    Wipe all rows in .env.test Supabase
npm run scrape                Alias for scrape:ojk
npm run scrape:ojk            Scrape OJK → data/ojk-scraped.json
npm run import:ojk            Push scraped data → Supabase (idempotent)
npm run import:ojk -- --test  Push scraped/manual data to .env.test Supabase
npm run data:refresh          scrape:ojk + import:ojk in one command
```

---

## Test environments explained

### `npm test` / `npm run test:all`

Runs entirely in-memory. No browser, no DB, no network. Always works on any machine. Unit tests cover `risk.ts`, `lookup.ts`, `validators.ts`, `supabase.ts`, `db.ts`. Integration tests cover all API route logic.

### `npm run test:e2e`

Playwright browser tests. Starts the dev server automatically with `NEXT_PUBLIC_USE_SUPABASE=false` — always uses SEED_DB regardless of what's in `.env.local`. Requires Playwright browsers: `npx playwright install chromium`.

### `npm run test:e2e:supabase`

Playwright browser tests against a real Supabase DB. Loads `.env.test`, validates you're not using prod credentials, starts the dev server pointed at the test DB. The `beforeAll` in the spec calls `POST /api/e2e-seed` to insert known test fixtures before tests run. `global-teardown.ts` cleans them after. Requires `.env.test` to be set up — see README.

---

## Data pipeline

**Full reset and fresh data import:**

```bash
npm run reset:db          # type "yes" to confirm — wipes all rows
npm run scrape:ojk        # scrapes OJK → data/ojk-scraped.json
                          # if OJK blocks (403), fill data/manual.csv first
npm run import:ojk        # pushes to Supabase, idempotent
```

`npm run import:ojk` reads `data/ojk-scraped.json` when present and falls back to `data/manual.csv` when the JSON file is absent. Add `-- --test` to DB scripts to load `.env.test`.

**Add new data without wiping:**

```bash
npm run scrape:ojk
npm run import:ojk        # safe to re-run anytime — duplicates ignored
```

**Manual CSV format** (`data/manual.csv`):

```
type,value,bank,scam_type
domain,investasi-bodong.com,,Investasi Bodong
bank_account,1234567890,BRI,Transfer Penipuan
phone,08123456789,,Phishing
```

---

## Test coverage

| File                            | Tests | Suite                              |
| ------------------------------- | ----- | ---------------------------------- |
| `lib/risk.ts`                   | 21    | `tests/unit/risk.test.ts`          |
| `lib/risk.ts` ↔ SQL view parity | 6     | `tests/unit/risk-parity.test.ts`   |
| `lib/lookup.ts`                 | 29    | `tests/unit/lookup.test.ts`        |
| `lib/validators.ts`             | 20    | `tests/unit/validators.test.ts`    |
| `lib/supabase.ts`               | 8     | `tests/unit/supabase.test.ts`      |
| `lib/db.ts`                     | 16    | `tests/unit/db.test.ts`            |
| `lib/rate-limit.ts`             | 7     | `tests/unit/rate-limit.test.ts`    |
| `lib/auth.ts`                   | 8     | `tests/unit/auth.test.ts`          |
| `/api/check` + `/api/report`    | 12    | `tests/integration/api.test.ts`    |
| All routes + CSV + auth guard   | 43    | `tests/integration/routes.test.ts` |
| App UI (3 tabs + admin)         | 30    | `tests/e2e/app.spec.ts`            |

**Total: 170 unit/integration + 30 e2e**

---

## Database schema

**`entities`** — the fraud entity
`id`, `type` (enum: bank_account/phone/ewallet/domain), `value` (normalised — lowercase, no spaces, no dashes, no protocol/path/www.), `bank` (nullable), `reports` (auto-incremented by trigger), `last_seen` (date), `created_at`, `source` (text, default `community`), `confidence` (smallint 0–100). **`UNIQUE(type, value)`** added in migration 002. **`idx_entities_value`** added in migration 003 (replaces the unused `lower(trim(value))` function index).

**`connections`** — graph edges
`from_id` → entities.id, `to_id` → entities.id, UNIQUE(from_id, to_id), CHECK(from_id ≠ to_id)

**`reports`** — individual fraud reports
`entity_id` → entities.id, `type` (scam_type enum), `amount` (nullable), `date`, `description` (CHECK length >= 10), `source` (text, default `community`), `confidence` (smallint 0–100), `submitter_ip_hash` (nullable text — SHA-256 of salt+IP for dedup, never raw IP).

Partial unique index `idx_reports_dedup` on `(entity_id, submitter_ip_hash, date)` where `submitter_ip_hash IS NOT NULL` — prevents the same IP submitting the same entity twice on the same day. The constraint surfaces as `DuplicateReportError` from `dbSubmitReport`, which the report route converts to HTTP 429.

**`entity_risk_summary`** — view that computes `risk_score` in SQL. Used by dashboard (`dbGetTopEntities`) to sort without loading every entity. Now also exposes `connection_count`, `source`, `confidence`. Migration 002 brings the formula in line with `lib/risk.ts` (per-component caps, future-date clamp). `tests/unit/risk-parity.test.ts` enforces parity.

**RLS policies** (after migration 002): public read on all three tables; **inserts restricted to the `service_role` Postgres role**. Server-side `supabaseAdmin()` (with the service-role / `sb_secret_*` key) is the only path that can write. The browser `anon` key cannot insert.

Migration files (apply in order):

- `supabase/migrations/001_initial_schema.sql` — tables, indexes, triggers, initial RLS, initial view
- `supabase/migrations/002_fix_risk_and_constraints.sql` — UNIQUE(type, value), service_role-only RLS, view formula matching `lib/risk.ts`
- `supabase/migrations/003_indexes_source_dedup.sql` — `idx_entities_value` (real index for `WHERE value = q`), `source`/`confidence` cols, `submitter_ip_hash` + dedup index, view exposes new cols

---

## Common mistakes to avoid

1. **Do not import SEED_DB in API routes.** All DB access goes through `db.ts`.
2. **Do not make `supabase.ts` exports module-level constants.** They must be functions — throw lazily, not at import time.
3. **Do not add a `connected` column to Supabase.** Assemble it at query time from the `connections` table.
4. **Do not hardcode `reports` count when seeding.** Insert `reports: 0`, let trigger handle it.
5. **Use `setupFilesAfterEnv` (not `setupFiles`) in `jest.config.ts`** for `@testing-library/jest-dom`.
6. **Do not include `tests/` in `tsconfig.json`.** Tests use `tsconfig.jest.json` with jest types. Mixing causes `beforeAll not found` in `next build`.
7. **After changing any Vercel env var, redeploy.** Vercel never hot-reloads env vars.
8. **E2E tests always run with `USE_SUPABASE=false`** unless explicitly using `test:e2e:supabase`. Do not run `npm run test:e2e` while your `.env.local` has `USE_SUPABASE=true` and expect it to test Supabase — it won't, the webServer env overrides it.
9. **Need ≥ 3 connections for guaranteed BAHAYA TINGGI** — with 2 connections max score without recency bonus is 76 (MENCURIGAKAN). Seed data uses 3 connections on the primary test entity.
10. **Always store normalized values** — never insert raw user input. Stored values must match `normalizeQuery(s)` so `.eq("value", q)` lookups find them. The validators do this automatically; new direct DB writes (e.g. seed scripts) must do it manually.
11. **Do not use substring/wildcard matching in lookup.** Exact match only. `%` and `_` in user input are treated as literal characters.
12. **Apply migration 002 _and_ 003 to every Supabase project** (test + prod) before deploying. The admin upload route and `dbSubmitReport` assume the unique constraints (002), the value index (003), the `source`/`confidence` columns (003), and the `submitter_ip_hash` dedup index (003) are all in place.
13. **If you change `lib/risk.ts`, change the SQL view in migration 003** (the active view definition). `tests/unit/risk-parity.test.ts` will fail on drift.
14. **Admin CSV upload must use `ignoreDuplicates: true`** when upserting entities. Setting it to `false` (the previous bug) merges new rows over old ones, overwriting `reports: 0` and destroying accumulated counts. The trigger handles count bumps via the report-row insert; the entity row is untouched on conflict.
15. **Do not import `lib/risk.ts` from client components.** Risk is precomputed on the server and shipped on every entity surface. The only place `calcRisk` runs client-side is the in-memory seed-fallback path inside `lib/lookup.ts`, which is server-side too.
16. **Do not compare admin/e2e keys with `===`.** Use `lib/auth.ts:safeEqual` (constant-time). The naive comparison is timing-attackable.
17. **Rate-limit state lives in module memory.** It's a Map that gets reset every cold start. Do NOT rely on it as a hard limit — the Postgres dedup index (migration 003) is the durable layer. If you swap to Upstash/Redis later, keep the same `RateLimitResult` shape.
18. **The `Content-Security-Policy` header is set by `src/middleware.ts`, not `next.config.js`.** It needs a per-request nonce. Static CSP in `next.config.js` would conflict; that's why it was removed there.
