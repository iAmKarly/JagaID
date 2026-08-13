# ⚔ JagaID — Anti-Fraud Intelligence Platform

> **Cek rekening penipu. Laporkan penipuan. Lindungi Indonesia.**

JagaID is a community-powered fraud intelligence platform for Indonesia. Anyone can check whether a bank account, phone number, e-wallet, or domain has been reported for fraud — and submit new reports. Behind the scenes it builds a graph of connected fraud entities, not just a blacklist.

---

## Features

- **CEK** — Search any bank account, phone number, e-wallet, or URL against a live fraud database with risk scoring and network graph
- **LAPOR** — Submit fraud reports with modus, amount, and description
- **DATA** — Real-time dashboard showing fraud statistics and top dangerous entities
- **Risk scoring** — 0–100 score based on report count, network connections, and recency
- **Graph intelligence** — Linked entities reveal fraud networks, not just single bad actors
- **Public API** — `GET /api/check?q=...` for fintech integrations
- **Admin upload** — Drag-and-drop CSV upload at `/admin/upload` to import OJK data
- **WhatsApp sharing** — One tap to warn your community

---

## Tech stack

| Layer                  | Choice                     |
| ---------------------- | -------------------------- |
| Framework              | Next.js 14 (App Router)    |
| Language               | TypeScript                 |
| Database               | Supabase (PostgreSQL)      |
| Validation             | Zod                        |
| Unit/Integration tests | Jest + ts-jest (170 tests) |
| E2E tests              | Playwright (30 tests)      |
| CI                     | GitHub Actions             |
| Deployment             | Vercel                     |

**Cost to run: $0** (within free tier limits on both Vercel and Supabase)

---

## Quick start

### Prerequisites

- Node.js >= 18.17.0 — [nodejs.org](https://nodejs.org) (enforced via `package.json` `engines`)
- npm v9+ (comes with Node)

### macOS

```bash
brew install node
git clone https://github.com/your-username/jagaid.git
cd jagaid
bash scripts/setup.sh
```

### Linux (Ubuntu / Debian)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
git clone https://github.com/your-username/jagaid.git
cd jagaid
bash scripts/setup.sh
```

`setup.sh` installs dependencies, creates `.env.local` from the template, installs Playwright browsers, and runs the unit tests to verify everything works.

### Manual setup

```bash
git clone https://github.com/your-username/jagaid.git
cd jagaid
npm install
cp .env.example .env.local   # fill in your values
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Environment variables

### `.env.local` — local development and production

Copy `.env.example` to `.env.local` and fill in:

| Variable                        | Required   | Description                                                                                                                                       |
| ------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes (prod) | Supabase project URL                                                                                                                              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (prod) | Public key — accepts legacy `anon` JWT or new `sb_publishable_*` opaque token                                                                     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Yes (prod) | Server-only — accepts legacy `service_role` JWT or new `sb_secret_*` opaque token. After migration 002, this is the **only** key allowed to write |
| `NEXT_PUBLIC_USE_SUPABASE`      | Yes (prod) | Set `true` to use live DB — leave `false` for dev                                                                                                 |
| `USE_SUPABASE`                  | E2E only   | Server-only runtime switch — set `true` in `.env.test`                                                                                            |
| `ADMIN_UPLOAD_KEY`              | Yes (prod) | Secret for `/admin/upload` and `/api/admin/*` (sent via `x-admin-key` header)                                                                     |
| `E2E_SEED_KEY`                  | E2E only   | Used by e2e tests to seed fixtures (sent via `x-e2e-key` header)                                                                                  |
| `ALLOWED_ORIGIN`                | Optional   | Production CORS origin (e.g. `https://jagaid.app`). Unset = same-origin only                                                                      |
| `NEXT_PUBLIC_APP_URL`           | Optional   | Origin used in WhatsApp share text fallback when `window.location.origin` isn't available                                                         |

Find Supabase keys at: **Supabase Dashboard → Project → Settings → API**

### `.env.test` — test Supabase project (e2e against real DB)

Copy `.env.test.example` to `.env.test` and fill in with your **test** Supabase project credentials. Never use production credentials here. See [E2E testing against Supabase](#e2e-testing-against-supabase) below.

---

## Database setup (production)

1. Create a free project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run all migrations in order:
   - `supabase/migrations/001_initial_schema.sql` — tables, indexes, triggers, base RLS, view
   - `supabase/migrations/002_fix_risk_and_constraints.sql` — `UNIQUE(type, value)`, service-role-only writes, fixed risk view
   - `supabase/migrations/003_indexes_source_dedup.sql` — value index, source/confidence columns, IP-hash dedup
3. Add your keys to `.env.local`
4. Run the app locally to verify: `npm run dev`

You don't need to run `db:seed` — the app works with in-memory seed data locally. Run `db:seed` only when you want to pre-populate your Supabase project.

> **Resetting an existing database?** Run `npm run reset:db` (deletes all rows, keeps schema) **before** applying migration 002. The new `UNIQUE(type, value)` constraint will fail if duplicate rows exist.

---

## Running tests

### Unit and integration tests (no browser, no DB needed)

```bash
npm test                  # 170 tests — runs instantly
npm run test:unit         # same, explicit alias
npm run test:watch        # re-run on file save
npm run test:coverage     # with coverage report (70% threshold enforced)
```

### E2E tests — seed-fallback mode (no Supabase needed)

Runs against the in-memory seed data. The fastest way to run e2e.

```bash
# Install Playwright browsers once
npx playwright install chromium

# Run e2e (dev server starts automatically)
npm run test:e2e

# Interactive UI mode
npm run test:e2e:ui
```

### E2E tests — Supabase mode (real DB)

Runs against a dedicated test Supabase project. See [E2E testing against Supabase](#e2e-testing-against-supabase).

```bash
npm run test:e2e:supabase
```

### Run everything

```bash
npm run test:all          # unit + integration + e2e (seed-fallback)
npm run test:ci           # same as test:all — alias used by CI pipeline
```

### Test structure

```
tests/
├── setup.ts
├── unit/
│   ├── risk.test.ts          21 tests — risk scoring engine
│   ├── risk-parity.test.ts    6 tests — TS calcRisk vs SQL view formula must agree
│   ├── lookup.test.ts        24 tests — exact-match search, normalization, no wildcards
│   ├── validators.test.ts    18 tests — Zod schema validation + normalization transforms
│   ├── db.test.ts            16 tests — database layer (seed fallback)
│   └── supabase.test.ts       8 tests — lazy client init and env validation
├── integration/
│   ├── api.test.ts           12 tests — check and report route logic
│   └── routes.test.ts        43 tests — all routes, admin auth, CSV parser
└── e2e/
    └── app.spec.ts           30 tests — full browser flows
```

---

## E2E testing against Supabase

To test the real database connection you need a **separate Supabase project for testing** — same schema, seed data, never touched by production traffic.

### Step 1 — Create a test Supabase project

Go to [supabase.com](https://supabase.com) → New Project → name it `jagaid-test`.

> Free tier allows 2 active projects. If you only have one, pause it temporarily, create the test project, then unpause.

### Step 2 — Apply the schema

In the `jagaid-test` SQL editor, paste and run all migrations in order:

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_fix_risk_and_constraints.sql
supabase/migrations/003_indexes_source_dedup.sql
```

### Step 3 — Create `.env.test`

```bash
cp .env.test.example .env.test
```

Fill in with the **test project** credentials from Supabase Dashboard → jagaid-test → Settings → API:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-TEST-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-test-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-test-service-role-or-secret-key
USE_SUPABASE=true
NEXT_PUBLIC_USE_SUPABASE=true
E2E_SEED_KEY=any-random-string
ADMIN_UPLOAD_KEY=any-random-string
```

### Step 4 — Run e2e against the test DB

```bash
npm run test:e2e:supabase
```

`npm run setup` creates `.env.test` from `.env.test.example` when it is missing. After filling in the test credentials, you can also include the real-DB e2e check during setup:

```bash
RUN_SUPABASE_E2E=1 bash scripts/setup.sh
```

The script automatically:

- Loads `.env.test`
- Validates you're not using production credentials
- Starts the dev server pointed at the test DB
- Runs Playwright — `beforeAll` seeds test fixtures via `/api/e2e-seed`
- Cleans up test fixtures after the suite

---

## Project structure

```
jagaid/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   ├── admin/upload/page.tsx         CSV upload UI at /admin/upload
│   │   └── api/
│   │       ├── check/route.ts            GET  /api/check?q=
│   │       ├── report/route.ts           POST /api/report
│   │       ├── stats/route.ts            GET  /api/stats
│   │       ├── e2e-seed/route.ts         POST/DELETE /api/e2e-seed (test fixtures)
│   │       └── admin/
│   │           ├── upload/route.ts       POST   /api/admin/upload
│   │           └── reset/route.ts        DELETE /api/admin/reset
│   ├── components/App.tsx
│   ├── middleware.ts                     CORS preflight (only fires when ALLOWED_ORIGIN set)
│   ├── lib/
│   │   ├── risk.ts                       risk scoring (pure functions)
│   │   ├── lookup.ts                     exact-match search + normalizeQuery
│   │   ├── validators.ts                 Zod schemas (apply normalizeQuery transform)
│   │   ├── seed-data.ts                  in-memory dev/test data (normalized values)
│   │   ├── db.ts                         all DB access (Supabase or seed fallback)
│   │   └── supabase.ts                   lazy Supabase client factories
│   └── types/index.ts
├── tests/
│   ├── setup.ts
│   ├── unit/                             pure function tests
│   ├── integration/                      API route logic tests
│   └── e2e/
│       ├── app.spec.ts                   browser flow tests
│       └── global-teardown.ts            cleans e2e fixtures after suite
├── scripts/
│   ├── setup.sh                          one-command dev setup
│   ├── seed.ts                           push seed data to Supabase
│   ├── reset-db.ts                       wipe all Supabase rows
│   ├── scrape-ojk.ts                     scrape OJK → data/ojk-scraped.json
│   ├── import-ojk.ts                     push scraped data → Supabase (deterministic IDs)
│   └── test-e2e-supabase.sh              run e2e against test Supabase project
├── supabase/migrations/
│   ├── 001_initial_schema.sql            tables, indexes, triggers, base RLS, view
│   ├── 002_fix_risk_and_constraints.sql  UNIQUE(type,value), service_role-only RLS, fixed view
│   └── 003_indexes_source_dedup.sql      value index, source/confidence, IP dedup
├── data/
│   ├── manual.csv                        template for manual CSV import
│   └── .gitignore
├── docs/
│   ├── ARCHITECTURE.md                   why each design decision was made
│   ├── API.md                            full API reference
│   ├── DATA.md                           data lifecycle (seed → import → reports)
│   ├── DEPLOYMENT.md                     Vercel + Supabase rollout
│   └── PROJECT_REFERENCE.md              detailed file-by-file reference
├── .github/workflows/ci.yml
├── .env.example                          template for .env.local
├── .env.test.example                     template for .env.test
├── CLAUDE.md                             AI assistant context
└── README.md
```

---

## API reference

### `GET /api/check`

Check if an entity has been reported for fraud. **Exact match only** — `q` is normalized (lowercased, whitespace and dashes stripped) and compared directly. Substring/wildcard search is intentionally disabled.

**Query params:** `q` — bank account, phone, e-wallet, or domain (5–200 chars before normalization)

```bash
curl "https://your-app.vercel.app/api/check?q=1234567890"
```

```json
{
  "found": true,
  "entity": {
    "id": "e1",
    "type": "bank_account",
    "value": "1234567890",
    "bank": "BRI",
    "reports": 20,
    "connected": ["e2", "e3", "e5"],
    "last_seen": "2024-12-01"
  },
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

### `POST /api/report`

Submit a fraud report. The `value` is normalized server-side via `normalizeQuery` before storage — clients can send raw input ("1234-567-890", "GoPay:08123456789") and it'll be stored as `1234567890`, `gopay:08123456789`.

```bash
curl -X POST https://your-app.vercel.app/api/report \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bank_account",
    "value": "1234567890",
    "bank": "BRI",
    "scam_type": "Transfer Penipuan",
    "amount": "Rp 2.500.000",
    "description": "Pelaku mengaku penjual dan menghilang setelah transfer."
  }'
```

See [docs/API.md](docs/API.md) for the full API reference (status codes, error shapes, all routes).

---

## Data management

### First-time setup (wipe seed data, import real OJK data)

```bash
npm run reset:db         # wipe all rows (prompts "yes" to confirm)
npm run scrape:ojk       # scrape OJK → data/ojk-scraped.json
npm run import:ojk       # push to Supabase
```

To target the test Supabase project instead, pass `--test` to DB scripts:

```bash
npm run reset:db -- --test
npm run db:seed -- --test
npm run import:ojk -- --test
```

### Add new data without wiping

```bash
npm run scrape:ojk
npm run import:ojk       # safe to re-run — duplicates ignored
```

### Manual CSV upload via browser

1. Go to `https://your-app.vercel.app/admin/upload`
2. Enter your `ADMIN_UPLOAD_KEY`
3. Click **Download Template**, fill it in, drag and drop the file

CSV format (parsed by `csv-parse/sync` — quoted values with embedded commas are supported):

```
type,value,bank,scam_type
domain,investasi-bodong.com,,Investasi Bodong
bank_account,1234567890,BRI,Transfer Penipuan
phone,08123456789,,Phishing
```

Values are **normalized** on insert (lowercased, whitespace and dashes stripped — dots and other punctuation kept). For example, `investasi-bodong.com` becomes `investasibodong.com`. Upsert keys on `(type, value)` so re-running with the same row is a no-op.

### OJK scraper note

OJK returns 403 to automated requests. If `npm run scrape:ojk` gets nothing, use the manual CSV fallback: fill `data/manual.csv` with data from the OJK website. You can either run `npm run scrape:ojk` to produce `data/ojk-scraped.json`, or run `npm run import:ojk` directly when `ojk-scraped.json` is absent — the importer will read `data/manual.csv` itself.

---

## Deployment (Vercel)

```bash
npm i -g vercel
vercel
```

Add these environment variables in Vercel Dashboard → Project → Settings → Environment Variables → **Production**:

```
NEXT_PUBLIC_SUPABASE_URL       = https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY  = <anon JWT or sb_publishable_*>
SUPABASE_SERVICE_ROLE_KEY      = <service_role JWT or sb_secret_*>
NEXT_PUBLIC_USE_SUPABASE       = true
ADMIN_UPLOAD_KEY               = <run: openssl rand -hex 32>
ALLOWED_ORIGIN                 = https://jagaid.app   # only if you need cross-origin API access
NEXT_PUBLIC_APP_URL            = https://jagaid.app   # used in WhatsApp share text
```

**After adding or changing any variable → redeploy.** Vercel does not hot-reload env vars into running deployments.

Also remember to apply all Supabase migrations to your prod project (`001_initial_schema.sql`, `002_fix_risk_and_constraints.sql`, then `003_indexes_source_dedup.sql`) before the first deploy.

---

## npm scripts

```bash
# Development
npm run dev                   Start dev server on :3000
npm run build                 Production build

# Testing
npm test                      Unit + integration (170 tests, no browser/DB needed)
npm run test:unit             Same as npm test
npm run test:watch            Watch mode
npm run test:coverage         With coverage report (70% threshold enforced)
npm run test:e2e              E2E browser tests, seed-fallback mode
npm run test:e2e:ui           E2E interactive UI mode
npm run test:e2e:supabase     E2E against real test Supabase DB (needs .env.test)
npm run test:all              Everything — unit + integration + e2e
npm run test:ci               Same as test:all — alias used by CI pipeline

# Database
npm run db:seed               Push seed data to Supabase
npm run db:seed -- --test     Push seed data to .env.test Supabase
npm run reset:db              Wipe all rows (confirmation prompt)
npm run reset:db -- --test    Wipe .env.test Supabase rows
npm run scrape                Alias for scrape:ojk
npm run scrape:ojk            Scrape OJK → data/ojk-scraped.json
npm run import:ojk            Push scraped data → Supabase (safe to re-run)
npm run import:ojk -- --test  Import into .env.test Supabase
npm run data:refresh          scrape:ojk + import:ojk in sequence
```

---

## Security model

- **Lookup is exact-match.** `q` is normalized (`normalizeQuery`: trim → lowercase → strip whitespace and `-`) and compared via `.eq()`. Substring matches and SQL `%/_` wildcards are intentionally disabled — the question is "did the user type this exact account?".
- **Stored values are always normalized.** Validators apply `normalizeQuery` on every API request; `dbSubmitReport` and the admin upload route normalize before insert.
- **Writes are service-role only** (after migration 002). Browser-exposed `anon` / `sb_publishable_*` keys cannot insert. The API routes use `supabaseAdmin()` server-side with the service-role / `sb_secret_*` key.
- **CORS is restrictive by default.** No `Access-Control-Allow-Origin` is sent unless `ALLOWED_ORIGIN` is set. `src/middleware.ts` handles preflight when configured.
- **Security headers**: `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`. CSP relaxes `'unsafe-eval'` only in dev (for HMR).
- **Admin/E2E auth**: secrets live in `ADMIN_UPLOAD_KEY` and `E2E_SEED_KEY` env vars. They're sent as `x-admin-key` / `x-e2e-key` request headers (not query strings — keys don't leak into logs).
- **No secrets in git**: `.env.local` and `.env.test` are gitignored. Templates (`.env.example`, `.env.test.example`) only contain placeholders.

---

## Roadmap

- [ ] Rate limiting on `/api/check` and `/api/report` (per-IP, via Upstash Redis)
- [ ] Neo4j graph layer for deeper network analysis
- [ ] OJK + BRTI automated scrape via Vercel cron
- [ ] Telegram bot for lookups
- [ ] Browser extension
- [ ] Fintech API dashboard with key management
- [ ] Admin moderation panel

---

- [ ] Neo4j graph layer for deep network analysis
- [ ] OJK + BRTI automated scrape (Vercel cron job)
- [ ] Rate limiting on API routes
- [ ] Telegram bot for lookups
- [ ] Browser extension
- [ ] Fintech API dashboard with key management
- [ ] Admin moderation panel

---

## Legal & ethics

- Only scrapes **publicly available** data — no auth bypass, no private groups
- No personal data stored beyond what reporters voluntarily submit
- Reports are community contributions, not legal verdicts
- Complies with Indonesian UU ITE and OJK data guidelines

---

## Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/your-feature`
3. Make changes and add tests
4. Ensure everything passes: `npm run test:all`
5. Open a pull request

---

## License

MIT — see [LICENSE](LICENSE)

---

_Built to protect Indonesia. Powered by community._
