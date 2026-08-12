# GitHub migration checklist

One-time checklist for getting this repo onto GitHub and into production. Specific to JagaID — assumes you've just run the recent batch of fixes (170 tests, migrations 001–003, IP hashing, etc).

> Once you've worked through this, decide whether to keep this file in the repo as historical reference or delete it.

---

## Phase 1 — Pre-push audit (local)

- [ ] **Verify nothing sensitive is about to be tracked.** The `.gitignore` already covers `.env*`, `node_modules/`, `.next/`, `coverage/`, `playwright-report/`, `data/ojk-scraped.json`, `.DS_Store`. Nothing to change there. Just confirm before staging:
  ```bash
  git status --short | grep -E '\.env(\..+)?$|credentials|key|secret'   # should be empty
  ```
- [ ] **Final green build locally:**
  ```bash
  npm test                    # 170 tests
  npx tsc --noEmit            # type-clean
  npm run lint
  npm run format:check
  npm run build               # needs internet for next/font's Google Fonts fetch
  ```
- [ ] **Init git + first commit:**
  ```bash
  git init -b main
  git add .
  git status                  # eyeball — should NOT include .env.local, .env.test, .DS_Store, .next/
  git commit -m "Initial commit"
  ```

---

## Phase 2 — Create the GitHub repo

- [ ] Create the repo on GitHub (`gh repo create jagaid --private --source=. --remote=origin` if you have the gh CLI; otherwise create empty on github.com and add the remote yourself).
- [ ] **Push:**
  ```bash
  git push -u origin main
  ```
- [ ] Verify the CI workflow at `.github/workflows/ci.yml` ran and the `test` + `e2e (seed-fallback)` jobs went green. The `e2e-supabase` job is gated and will be skipped — that's expected until Phase 3.

---

## Phase 3 — GitHub Actions secrets and variables

The CI file already references these. Set them in **Settings → Secrets and variables → Actions**:

- [ ] **Repository secrets** (Secrets tab):
  - `TEST_SUPABASE_URL` — your `jagaid-test` project URL (NOT prod)
  - `TEST_SUPABASE_ANON_KEY`
  - `TEST_SUPABASE_SERVICE_ROLE_KEY`
  - `E2E_SEED_KEY` — match your `.env.test` value
  - `ADMIN_UPLOAD_KEY` — match your `.env.test` value
- [ ] **Repository variable** (Variables tab):
  - `RUN_E2E_SUPABASE = true` — opts the `e2e-supabase` job in. Skip this if you don't have a test Supabase project yet; CI still passes via the seed-fallback job.

---

## Phase 4 — Branch protection (recommended for `main`)

Settings → Branches → Add rule for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: `Unit & Integration Tests`, `E2E Tests (seed-fallback)`
- [ ] Require branches to be up to date before merging
- [ ] Block force pushes to `main`

---

## Phase 5 — Supabase + Vercel for production

- [ ] **Apply migrations to prod Supabase, in order**, via the SQL editor:
  - `supabase/migrations/001_initial_schema.sql`
  - `supabase/migrations/002_fix_risk_and_constraints.sql`
  - `supabase/migrations/003_indexes_source_dedup.sql`
- [ ] (Optional) seed initial data: `npm run db:seed` from your machine pointing at the prod project, or upload via `/admin/upload`.
- [ ] **Vercel — Import the GitHub repo**, then set env vars (Settings → Environment Variables, Production scope):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `NEXT_PUBLIC_USE_SUPABASE = true`
  - `ADMIN_UPLOAD_KEY` — long random string
  - `IP_HASH_SALT` — long random string (new since the recent fixes)
  - `ALLOWED_ORIGIN = https://jagaid.app` (or whatever domain you ship)
  - `NEXT_PUBLIC_APP_URL = https://jagaid.app`
- [ ] Trigger a Vercel deploy and verify `/api/stats` returns real counts.

---

## Phase 6 — Optional polish

- [ ] **Dependabot** — create `.github/dependabot.yml` for weekly npm + Actions updates.
- [ ] **CODEOWNERS** — `.github/CODEOWNERS` so PRs auto-request your review.
- [ ] **Issue / PR templates** — `.github/ISSUE_TEMPLATE/` and `.github/pull_request_template.md`.
- [ ] **README badges** — CI status, license, Vercel deploy.
- [ ] **`engines` enforcement** — already declared (`node >=18.17.0`); add `"packageManager": "npm@x.y.z"` if you want a hard pin.

---

## Notes specific to this repo

- `.env.local` and `.env.test` are already gitignored — leave them on your machine, never commit.
- `package-lock.json` IS tracked (good — CI uses `npm ci`).
- `.DS_Store` exists locally but is ignored — won't leak.
- The CI workflow's `e2e-supabase` job uses `?key=${E2E_SEED_KEY}` query-string auth, but the route now requires the `x-e2e-key` header (header-only after the recent admin-upload hardening). If you want that job to work, update those two `curl` calls in `.github/workflows/ci.yml` to send the key as a header instead. Low priority — only matters if you flip `RUN_E2E_SUPABASE=true`.
