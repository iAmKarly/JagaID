# Architecture

This document explains why JagaID is built the way it is — the decisions that aren't obvious from reading the code.

---

## System overview

```
Browser (user)
    │
    │  fetch("/api/check?q=...")
    │  fetch("/api/report", POST)
    │  fetch("/api/stats")
    ▼
Vercel Edge (Next.js API routes)
    │
    │  db.ts — single gateway
    │
    ├── NEXT_PUBLIC_USE_SUPABASE=false → SEED_DB (in-memory, dev/test)
    └── NEXT_PUBLIC_USE_SUPABASE=true  → Supabase PostgreSQL (prod)
                                              │
                                        entities table
                                        reports table
                                        connections table (graph edges)
                                        entity_risk_summary view
```

---

## Why the data layer is a single gateway (`db.ts`)

All database access goes through `src/lib/db.ts`. The API routes never import from `supabase.ts` or `seed-data.ts` directly.

The reason is the `NEXT_PUBLIC_USE_SUPABASE` flag. When it's false, `db.ts` returns data from the in-memory `SEED_DB` object — no network, no credentials required. This means:

- Tests run without a real database and without mocking Supabase
- Development works offline or before you have a Supabase project set up
- The switch to production is a single env var change, not a code change

The flag is `NEXT_PUBLIC_` — meaning Next.js bakes it into the client bundle at build time. This is intentional: the client-side risk scoring and dashboard data also need to know which mode they're in, and the only way for client code to read server env vars is if they're `NEXT_PUBLIC_`.

The downside is that changing the flag requires a redeploy. This is acceptable — you don't toggle production/dev mode at runtime.

---

## Why `App.tsx` calls API routes instead of reading the DB directly

`App.tsx` is a `"use client"` component. In Next.js, client components run in the browser. The browser cannot access:

- `SUPABASE_SERVICE_ROLE_KEY` (server-only, never sent to browser)
- `SUPABASE_SERVICE_ROLE_KEY`-gated operations
- Node.js APIs

If `App.tsx` called `supabase()` directly, it would use the anon key — which is fine for reads but can't be used for admin writes. More importantly, environment variables set in Vercel's dashboard for server-side use would have no effect on a client component.

The architecture is:

```
App.tsx (browser) → fetch("/api/...") → route.ts (server) → db.ts → Supabase
```

This is the correct Next.js pattern and is why Vercel env vars work correctly.

---

## Risk scoring formula

The risk score is a number from 0 to 100 calculated from three components:

```
reportScore  = min(reports × 4,       60)   # max 60 points
networkScore = min(connections × 8,   24)   # max 24 points
recencyScore = 15 | 8 | 0                   # max 15 points (activity < 30d | < 90d | older)

total = min(reportScore + networkScore + recencyScore, 100)
```

**Why these weights?**

Reports are the primary signal. 15+ reports gets you the maximum report score — at 4 points each. The cap at 60 prevents a single spammy entity from hitting 100 just from report volume.

Network connections are a strong multiplier. A bank account connected to 3 other accounts and 2 domains is almost certainly a mule network. At 8 points per connection, 3 connections adds 24 points — enough to push a lightly-reported entity from WASPADA to MENCURIGAKAN.

Recency matters because old data decays. An account reported once in 2019 is less dangerous than one reported yesterday. The 30-day window matches typical police/OJK reporting cycles.

**Why pure functions?**

`risk.ts` has zero imports from db, no async, no side effects. This lets it run identically in:
- Unit tests (170 unit/integration tests never touch a network)
- API route responses (server-side)
- Browser dashboard (client-side, for the entity list sorted by risk)

If risk scoring ever needed a DB lookup (e.g. velocity data), it would become a separate async function in `db.ts`, not a change to `risk.ts`.

**Future-date clamp.** `calcRecencyScore` returns `0` when `daysSince < 0` (i.e. `last_seen` is in the future, due to clock skew or bad data). Without this, a misconfigured client could push every reported entity to the highest recency tier. The SQL view in migration 002 has a matching `when last_seen > current_date then 0` clause, and `tests/unit/risk-parity.test.ts` includes a future-date sample to catch any drift between TS and SQL.

---

## Database schema design

### Why connections are a separate table

The first instinct is to put `connected: string[]` as an array column on `entities`. We didn't, for these reasons:

**1. Bidirectional queries are simpler.** If A is connected to B, you want to find that connection whether you start from A or B. With a separate table and an OR query (`from_id = X OR to_id = X`), this is one query. With an array column, you'd need to either store the connection twice (denormalised, gets out of sync) or do a full table scan.

**2. Graph traversal scales.** The current query returns direct connections (depth-1). When we add multi-hop traversal (finding that Account A → Account B → Domain C → 40 victims), the `connections` table plugs directly into recursive CTEs or a graph database. An array column doesn't.

**3. FK integrity.** `connections.from_id` and `connections.to_id` both reference `entities.id` with `ON DELETE CASCADE`. When an entity is deleted, all its connections are automatically cleaned up. You can't enforce this with an array column.

The `connected: string[]` field in the TypeScript `Entity` type is a computed/denormalised field that gets populated at query time by joining the `connections` table. It's not stored in Postgres.

### Why the report count is a trigger, not application logic

The `reports` count on `entities` is kept in sync by a DB trigger (`trg_increment_report_count`). Every `INSERT INTO reports` automatically increments the parent entity's count and updates `last_seen`.

The alternative — updating the count in application code — has a race condition. If two users submit reports for the same entity simultaneously, both read `reports = 5`, both write `reports = 6`, and one report is silently lost. The trigger runs inside the same transaction as the insert, so it's always consistent even under concurrent load.

The import script inserts entities with `reports: 0`, then inserts the report rows. The trigger handles the counting. The seed script does a final `PATCH` to correct counts after idempotent re-seeds (because `ignore-duplicates` means the trigger doesn't fire for skipped rows).

### Row Level Security

RLS is enabled on all three tables. After migration 002:
- **Reads** are public (`for select using (true)`) on `entities`, `reports`, `connections`.
- **Writes** are restricted to the Postgres `service_role` role (`for insert to service_role with check (true)`). The browser-exposed `anon` / `sb_publishable_*` key cannot insert; only server-side code holding the `service_role` / `sb_secret_*` key can. All API routes that write (`/api/report`, `/api/admin/upload`, `/api/e2e-seed`) call `supabaseAdmin()`, which uses the secret key.

This makes RLS the second line of defense: even if the API's Zod validation has a bug, a browser holding the public key still can't insert garbage.

### The `entity_risk_summary` view

The SQL view replicates `lib/risk.ts` exactly. After migration 002 the formula has per-component caps and the future-date clamp:

```sql
least(
  least(e.reports * 4, 60)
  + least(connection_count * 8, 24)
  + case
      when e.last_seen > current_date then 0
      when e.last_seen >= current_date - interval '30 days' then 15
      when e.last_seen >= current_date - interval '90 days' then 8
      else 0
    end,
  100
) as risk_score
```

This view is used by `dbGetTopEntities` and `dbGetStats` to filter and sort by risk score entirely in the database — no application-side sorting needed. **The SQL formula must stay in sync with `risk.ts`.** `tests/unit/risk-parity.test.ts` enforces parity by computing the SQL formula in JS and comparing against `calcRiskScore` for a sample set including caps and edge cases (future dates, large connection counts).

---

## Why lookup is exact-match (no substring, no wildcards)

`src/lib/lookup.ts:matchesEntity` returns `true` only when `normalizeQuery(entity.value) === normalizeQuery(query)`. The Supabase path uses `.eq("value", q)`, never `.ilike("%q%")`.

This is the safe default for an anti-fraud lookup tool:

- A query for `123` should not match `1234567890`. If a user types only the first three digits, the answer is "I don't know that account" — not "here's a high-risk entity that vaguely matches". Surfacing the wrong entity at the highest risk score would be worse than surfacing nothing.
- SQL `%` and `_` (wildcards in `ILIKE`) become literal characters when matching with `.eq()`. A malicious or accidental `%` in user input cannot return wildcard matches.
- Substring queries are an attack vector for enumeration: `1`, `12`, `123` would let an attacker scan all stored values. Exact match removes that.

The cost: typos and partial inputs return "not found". The UI mitigates this with example badges and the LAPOR ("report") tab — if you can't find an entity, you can submit it.

---

## Why values are normalized everywhere

`normalizeQuery(s) = s.trim().toLowerCase().replace(/[\s\-]/g, "")` — defined in `src/lib/lookup.ts`. Applied at three boundaries:

1. **Validators** (`ReportPayloadSchema.value`, `LookupQuerySchema.q`) — Zod `.transform(normalizeQuery)`. Every API request comes through normalized.
2. **`db.ts` writes** — `dbSubmitReport` stores `normalizeQuery(payload.value)`.
3. **Admin upload** — `parseCsv` keeps the raw value in the row, then `entityInserts` runs `normalizeQuery(r.value)` before insert.

The benefit is that `1234-567 890`, `1234567890`, and `  1234567890  ` all become the same stored row. Lookups via `.eq("value", q)` then trivially match the right entity regardless of how a user formats their input. Without this, exact match would be brittle.

The seed data and OJK import scripts also store values pre-normalized so `dbLookup` finds them.

---

## CORS and the middleware

`next.config.js` ships fixed security headers (`X-Content-Type-Options`, `Referrer-Policy`, `Strict-Transport-Security`, `Content-Security-Policy`) on every response. CSP relaxes `'unsafe-eval'` and `ws://localhost:*` only in dev mode (Next HMR needs both); production locks them down.

CORS is opt-in. If `ALLOWED_ORIGIN` is unset, the API has no `Access-Control-Allow-Origin` header — only same-origin requests work, which is the desired default for a single-domain app. If `ALLOWED_ORIGIN=https://jagaid.app` is set:

- `next.config.js` adds the `Access-Control-Allow-*` response headers on `/api/*`.
- `src/middleware.ts` answers preflight `OPTIONS` requests with 204 and the matching headers — but only if the request `Origin` matches `ALLOWED_ORIGIN`. Mismatched origins get 403.

This means cross-site `fetch` from a victim's browser cannot post reports against arbitrary entities, which the wildcard `*` policy used to allow. Same-origin browser behaviour (loading `/api/check` from your own domain) doesn't trigger preflight, so the middleware is a no-op there.

---



```typescript
// Bad — throws at module load time
export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,  // undefined during next build
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// Good — throws only when called
export function supabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL");
  return createClient(url, ...);
}
```

Next.js evaluates route modules at build time to generate the static page manifest. If the Supabase client throws during module evaluation (because env vars aren't set in CI), `next build` fails. Making the clients lazy functions means the build succeeds — the error only surfaces at runtime when you actually try to use them.

---

## Admin security model

The admin endpoints (`/api/admin/upload`, `/api/admin/reset`) check the `x-admin-key` request header against the `ADMIN_UPLOAD_KEY` environment variable. (A `?admin_key=` query-string fallback is also accepted; the header is preferred because it doesn't leak into server access logs.)

This is a single shared secret, not per-user auth. It was a deliberate MVP choice. Adding Supabase Auth or NextAuth would add meaningful complexity for a single operator. The admin upload page is at `/admin/upload` — not linked from anywhere in the main UI — and requires knowing the secret key.

When multiple operators need access (e.g. a team of fraud analysts), the right upgrade is:

1. Add Supabase Auth with email/password
2. Create a `roles` table with an `admin` flag
3. Replace the header check with a session check in the route middleware

The e2e seed endpoint (`POST /api/e2e-seed`) follows the same pattern: it requires `x-e2e-key` matching `E2E_SEED_KEY`. Both keys are independently rotatable.

---

## Why OJK scraping is hard

OJK's portal returns HTTP 403 to any automated request that doesn't look like a real browser session. This is deliberate — they want humans to use their UI, not bots to extract their data.

The scraper in `scripts/scrape-ojk.ts` sends realistic browser headers and a polite User-Agent. This works inconsistently depending on IP reputation and OJK's current blocking rules.

The reliable production workflow is the manual CSV path: download OJK's published PDF list, copy the data into `data/manual.csv` using the template format, then run `npm run import:ojk`. If `data/ojk-scraped.json` exists, the importer uses it; otherwise it imports `data/manual.csv` directly. You can still run `npm run scrape:ojk` first when you want to combine live scrape results with manual CSV rows and review the generated JSON artifact.

---

## Test strategy

Tests are separated by speed and concern:

**Unit tests** (`tests/unit/`) test pure functions with zero network calls. They run in ~50ms and cover risk scoring, lookup logic, validation schemas, DB gateway seed path, and Supabase client error handling.

**Integration tests** (`tests/integration/`) test API route handler logic by simulating the handlers directly — no HTTP server, no Supabase. They verify that inputs flow correctly through validation → business logic → response shape.

**E2E tests** (`tests/e2e/`) use Playwright to run the full app in a real browser. They test user journeys end-to-end including the admin upload page. They require a running dev server.

The `data-testid` attribute convention is used throughout `App.tsx` so E2E tests never rely on text content or CSS classes, which change frequently. The testids are cross-checked against the spec in CI to catch drift.

Coverage is enforced at 70% as a floor. The Supabase path in `db.ts` is not unit tested (it would require a live DB or a complex mock) — it's covered by the real integration tests run against Supabase in staging.
