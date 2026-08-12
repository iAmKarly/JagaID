# Deployment

Step-by-step guide for deploying JagaID to Vercel + Supabase from scratch.

---

## Prerequisites

- A [Supabase](https://supabase.com) account (free tier is fine)
- A [Vercel](https://vercel.com) account (free tier is fine)
- Node.js >= 18.17.0 on your local machine (enforced via `package.json` `engines`)
- The JagaID repo cloned locally

---

## Step 1 — Set up Supabase

### 1.1 Create a project

Go to [app.supabase.com](https://app.supabase.com) → New Project. Choose any name and region (Singapore is closest to Indonesia).

### 1.2 Run the schema migrations

Go to **SQL Editor** in your Supabase project and run all migrations in order. Paste each, click **Run**, then move on.

```
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_fix_risk_and_constraints.sql
supabase/migrations/003_indexes_source_dedup.sql
```

`001` creates tables, indexes, triggers, base RLS, and the initial `entity_risk_summary` view. `002` adds `UNIQUE(type, value)` on `entities`, locks down RLS so only the service role can write, and updates the view to match the per-component caps and future-date clamp in `src/lib/risk.ts` exactly. `003` adds the real value lookup index, source/confidence fields, submitter IP hash deduplication, and exposes the new fields through the risk summary view.

> **If you're upgrading an existing project from `001` only**, run `npm run reset:db` (or otherwise empty the entities table) before applying `002`. The new unique constraint will fail if duplicate `(type, value)` rows exist.

### 1.3 Get your API keys

Go to **Settings → API** in your Supabase project. You'll need:

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **anon / publishable key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY` (legacy `eyJ...` JWT or new `sb_publishable_*` token both work)
- **service_role / secret key** → `SUPABASE_SERVICE_ROLE_KEY` (legacy `eyJ...` JWT or new `sb_secret_*` token; **server-only — never expose**)

---

## Step 2 — Deploy to Vercel

### 2.1 Import the repo

Go to [vercel.com/new](https://vercel.com/new) → Import Git Repository → select your JagaID repo.

Framework: **Next.js** (auto-detected).

### 2.2 Add environment variables

Before clicking Deploy, add these for the **Production** environment:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxxxx.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon JWT or `sb_publishable_*` token |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role JWT or `sb_secret_*` token |
| `NEXT_PUBLIC_USE_SUPABASE` | `true` |
| `ADMIN_UPLOAD_KEY` | Generate with: `openssl rand -hex 32` |
| `ALLOWED_ORIGIN` | (Optional) `https://your-domain.com` — only set if you need cross-origin API access from a different domain. Leave unset for same-origin only |
| `NEXT_PUBLIC_APP_URL` | (Optional) `https://your-domain.com` — fallback origin used in the WhatsApp share text when `window.location.origin` isn't available |

Make sure all variables are set for the **Production** environment (not just Preview or Development). Each Preview branch picks up Production env vars by default, but you can override per-environment if needed.

### 2.3 Deploy

Click **Deploy**. First deploy takes ~2 minutes.

---

## Step 3 — Load initial data

You have two options. The admin UI is easier if you're not comfortable with the terminal.

### Option A: Admin upload page (no terminal needed)

1. Go to `https://your-app.vercel.app/admin/upload`
2. Enter your `ADMIN_UPLOAD_KEY`
3. Click **Reset Database** → confirm → this wipes the seed data
4. Download the CSV template
5. Fill in OJK fraud data (see [DATA.md](DATA.md) for format)
6. Drag & drop the CSV → click **Upload ke Supabase**

### Option B: Terminal (more control)

```bash
# 1. Set up .env.local with your Supabase keys
cp .env.example .env.local
# Edit .env.local and fill in your keys

# 2. Wipe seed data
npm run reset:db
# Type "yes" when prompted

# 3a. If OJK scraping works from your IP:
npm run scrape:ojk
npm run import:ojk

# 3b. If OJK blocks you (common), use manual CSV:
# Fill data/manual.csv with your fraud data
npm run scrape:ojk    # optional: creates data/ojk-scraped.json from manual.csv
npm run import:ojk
```

`npm run import:ojk` reads `data/ojk-scraped.json` when it exists. If that file is absent, it imports `data/manual.csv` directly. To run the same DB scripts against the test Supabase project, pass `--test` so they load `.env.test`, for example `npm run reset:db -- --test` or `npm run import:ojk -- --test`.

---

## Step 4 — Verify

Visit your deployed app and check that real data appears:

1. Go to **DATA** tab — should show non-zero counts from your imported data
2. Go to **CEK** tab — search for an entity you know you imported
3. Visit `/api/check?q=your-test-value` — should return `found: true` with real risk data

If the app still shows seed data (the 6 hardcoded entities from dev), check:

1. `NEXT_PUBLIC_USE_SUPABASE=true` is set in Vercel (not just locally)
2. The variable is set for **Production** environment specifically
3. You've triggered a new deployment after setting the variable — Vercel doesn't hot-reload env vars

---

## Adding env vars after initial deploy

If you add or change environment variables in Vercel, you must **redeploy** for them to take effect:

Vercel Dashboard → Deployments → latest deployment → **Redeploy** (no cache clear needed).

Or push any commit to trigger an automatic redeploy.

---

## Custom domain

Vercel Dashboard → your project → **Settings → Domains** → add your domain. Add the DNS records Vercel shows you (usually a CNAME for `www` and an A record for the apex).

Update `metadataBase` in `src/app/layout.tsx`:

```typescript
metadataBase: new URL("https://jagaid.id"),
```

---

## Local development after deployment

Once you have a production Supabase project, you can point local dev at it too:

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
NEXT_PUBLIC_USE_SUPABASE=true
ADMIN_UPLOAD_KEY=your-admin-key
```

Or keep `NEXT_PUBLIC_USE_SUPABASE=false` locally to develop against seed data without touching the live DB.

---

## Environment variable reference

| Variable | Required | Server/Client | Description |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes (prod) | Both | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes (prod) | Both | anon JWT or `sb_publishable_*` token |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes (prod) | Server only | service_role JWT or `sb_secret_*` token. After migration 002, this is the only key allowed to write |
| `USE_SUPABASE` | E2E only | Server only | Runtime switch read by `db.ts` on every request. Set in `.env.test` for local Supabase e2e |
| `NEXT_PUBLIC_USE_SUPABASE` | Yes (prod) | Both | Build-time switch baked into the client bundle. Must be `"true"` to use Supabase |
| `ADMIN_UPLOAD_KEY` | Yes (prod) | Server only | Protects `/admin/*` and `/api/admin/*`. Sent via `x-admin-key` header |
| `E2E_SEED_KEY` | E2E only | Server only | Protects `/api/e2e-seed`. Sent via `x-e2e-key` header |
| `ALLOWED_ORIGIN` | Optional | Server only | Production cross-origin allowlist (single domain). Unset = same-origin only |
| `NEXT_PUBLIC_APP_URL` | Optional | Both | Fallback origin used in WhatsApp share text |
| `SCRAPER_CONTACT_EMAIL` | Optional | Server only | Contact email injected into the OJK scraper's User-Agent |

Variables prefixed `NEXT_PUBLIC_` are included in the client-side JavaScript bundle. Do not put secrets in `NEXT_PUBLIC_` variables.

---

## Troubleshooting

**App shows seed data in production**
→ `NEXT_PUBLIC_USE_SUPABASE` is not set to `"true"`, or the deployment predates the env var being added. Redeploy.

**`/api/check` returns 500**
→ Check Vercel function logs. Usually means Supabase credentials are wrong or the `entities` table doesn't exist (schema migrations weren't run — both `001` and `002` are required).

**`/api/report` returns 500 with "policy" or "permission" in the error**
→ Migration 002's RLS lockdown is in place but the route isn't using `supabaseAdmin()`. Verify `SUPABASE_SERVICE_ROLE_KEY` is set in Vercel and redeploy. Also confirm no code path is using the anon `supabase()` client for writes.

**Admin upload returns 401**
→ The `x-admin-key` header doesn't match `ADMIN_UPLOAD_KEY`. Check both are the same value. It's case-sensitive.

**Cross-origin API request blocked**
→ Either `ALLOWED_ORIGIN` isn't set (intentional default — same-origin only), or it's set to a different domain than the caller. The browser's network tab will show "blocked by CORS policy". Set `ALLOWED_ORIGIN=https://your-caller-domain.com` and redeploy.

**`next build` fails with "Missing NEXT_PUBLIC_SUPABASE_URL"**
→ The Supabase client is being imported at module evaluation time somewhere. The clients in `supabase.ts` are lazy functions — check that nothing is calling `supabase()` at the module level.

**OJK scraper returns 0 entities**
→ OJK is blocking the request (403). Fill `data/manual.csv`; `npm run import:ojk` can import it directly when `data/ojk-scraped.json` is absent. See [DATA.md](DATA.md).

**Admin upload fails with "duplicate key value violates unique constraint"**
→ You ran migration 002 against a DB that already had duplicate `(type, value)` rows. Run `npm run reset:db` first, then re-apply migrations 002 and 003, then re-import.
