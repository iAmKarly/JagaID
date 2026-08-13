# Data Pipeline

This document covers how data gets into JagaID — from OJK scraping to CSV import to the admin upload UI.

---

## Data sources

JagaID's data comes from four sources, in order of reliability:

| Source                    | How                      | Reliability      | Volume         |
| ------------------------- | ------------------------ | ---------------- | -------------- |
| OJK Investor Alert Portal | Automated scrape         | Low (403 blocks) | High quality   |
| Satgas Waspada Investasi  | Automated scrape         | Low (403 blocks) | High quality   |
| PatroliSiber.id           | Automated scrape         | Medium           | Medium quality |
| Manual CSV                | You fill in the template | 100%             | You control it |

In practice, **the manual CSV is the primary production workflow**. OJK's portal blocks automated requests most of the time. The scrapers exist for when access is possible and as a foundation for future improvements (Playwright-based browser scraping, rotating proxies, etc.).

---

## Entity types

Every entity in JagaID has one of four types:

| Type           | Example input         | Stored as            | Description                                     |
| -------------- | --------------------- | -------------------- | ----------------------------------------------- |
| `bank_account` | `1234567890`          | `1234567890`         | Bank account number, with optional `bank` field |
| `phone`        | `0812-3456-789`       | `08123456789`        | Indonesian mobile number                        |
| `ewallet`      | `GoPay:08123456789`   | `gopay:08123456789`  | GoPay, OVO, Dana, ShopeePay                     |
| `domain`       | `Investasi-Cepat.com` | `investasicepat.com` | Website or URL                                  |

**Values are always normalized before storage.** `normalizeQuery` (in `src/lib/lookup.ts`) trims, lowercases, and strips whitespace and `-`. The CSV importer, the `/api/report` validator, the e2e seed route, and `scripts/seed.ts` all apply it. This is what lets `dbLookup` use `.eq("value", q)` for exact match — both sides of the comparison are guaranteed to be in the same form.

---

## CSV format

The import format is straightforward:

```csv
type,value,bank,scam_type
bank_account,1234567890,BRI,Transfer Penipuan
bank_account,9876543210,BCA,Investasi Bodong
phone,08123456789,,Phishing
ewallet,GoPay:08123456789,,Transfer Penipuan
domain,investasi-cepat.com,,Investasi Bodong
domain,pinjol-kilat.id,,Pinjol Ilegal
```

**Column rules:**

- `type` — one of: `bank_account`, `phone`, `ewallet`, `domain`. The importer also accepts loose synonyms (e.g. `hp` → `phone`, `gopay` → `ewallet`, `url` → `domain`).
- `value` — the actual number/URL. Minimum 5 characters before normalization. Normalized on insert (lowercased, whitespace and dashes stripped).
- `bank` — optional. Only relevant for `bank_account`. Values: BCA, BRI, BNI, Mandiri, BSI, CIMB, Danamon, Permata, BTN, Lainnya
- `scam_type` — optional. Defaults to `Lainnya`. Free-text matches like "investasi", "phish", "pinjol", "transfer" are mapped to enum values.

**Parser rules:**

- Parsed by `csv-parse/sync` — handles quoted values with embedded commas (`"Wahyu, Inc",...`), embedded newlines in quoted fields, CRLF/LF line endings, BOM-prefixed files
- Header row is required. Header names are case-insensitive
- Rows with empty `value` are silently skipped
- Irregular column counts are tolerated (`relax_column_count: true`)

Download the template from the admin upload page at `/admin/upload`.

---

## The full data pipeline

### Option A: Automated (when OJK allows it)

```
npm run scrape:ojk
    │
    ├── Hits sikapiuangmu.ojk.go.id (Investor Alert Portal)
    ├── Hits ojk.go.id (SWI press releases)
    ├── Hits patrolisiber.id
    └── Loads data/manual.csv (always)
    │
    ▼
data/ojk-scraped.json
    │
npm run import:ojk
    │
    ├── Reads ojk-scraped.json if present
    ├── Falls back to data/manual.csv when ojk-scraped.json is absent
    ├── Filters bad/short values
    ├── Batch-inserts entities (50 per request, ignore-duplicates)
    └── Batch-inserts reports (trigger increments entity.reports)
    │
    ▼
Supabase
```

### Option B: Manual CSV (reliable)

```
Download OJK PDF list manually
    │
    ▼
Fill data/manual.csv using template
    │
npm run import:ojk    ← reads manual.csv directly if ojk-scraped.json is absent
    │
    ▼
Supabase
```

You can still run `npm run scrape:ojk` first if you want a reviewed `data/ojk-scraped.json` artifact before importing.

### Option C: Browser upload (no terminal needed)

```
Go to /admin/upload on your deployed Vercel app
    │
Enter ADMIN_UPLOAD_KEY
    │
Drag & drop your CSV file
    │
Click "Upload ke Supabase"
    │
    ▼
Supabase (via /api/admin/upload route)
```

---

## Idempotency — running import twice

All import operations are safe to run multiple times:

- `npm run db:seed` — uses `resolution=ignore-duplicates` in Supabase upsert. Running it twice inserts nothing extra.
- `npm run import:ojk` — same: `ignore-duplicates`. IDs are deterministic (`ojk_<type>_<slug>`), so the same scraped row always produces the same row in Postgres. Re-importing only inserts new entities.
- `/api/admin/upload` — uses Supabase `upsert` with `onConflict: "type,value"` and `ignoreDuplicates: true` for entities. Uploading the same entity row leaves the existing entity untouched, so accumulated `reports` counts are not overwritten.

For the test Supabase project, pass `--test` to scripts that connect directly to Supabase:

```bash
npm run db:seed -- --test
npm run reset:db -- --test
npm run import:ojk -- --test
```

The one edge case: the DB trigger increments `entity.reports` on every `INSERT INTO reports`. The admin upload route inserts a new report row per upload by design (so the most recent provenance is always recorded), which means re-running it does increment the count. If you want to skip duplicate reports too, add an `onConflict` for the reports table or pre-check existing rows. For seed/import scripts, `ignore-duplicates` keeps counts stable across re-runs.

---

## Resetting the database

Before loading real OJK data, wipe the seed data:

```bash
# From your local machine (not Vercel)
npm run reset:db
```

This will:

1. Show current row counts
2. Ask you to type `"yes"` to confirm
3. Delete rows in FK-safe order: `reports` → `connections` → `entities`
4. Report how many rows were deleted

The script reads `.env.local` by default, or `.env.test` when you pass `--test`, and uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. After migration 002, this is the only key allowed to delete; the browser anon key cannot.

Alternatively, hit `DELETE /api/admin/reset` with the `x-admin-key` header (or use the Reset section on `/admin/upload` if it exists in your build).

The schema (tables, indexes, triggers, view) is never touched by reset. Only rows are deleted. **If you're moving to migration 002 from scratch, run `npm run reset:db` BEFORE applying 002** — the new `UNIQUE(type, value)` constraint will fail if duplicate rows exist.

---

## Data quality considerations

### What OJK data looks like

OJK's Investor Alert Portal lists entities alphabetically with a name and URL. The quality is high — these are officially flagged illegal investment companies. Typical scam types from OJK data: `Investasi Bodong`, `Phishing`.

The SWI (Satgas Waspada Investasi) press releases contain more narrative text with embedded account numbers and phone numbers. Quality is medium — regex extraction from paragraph text will produce false positives (random numbers that look like account numbers).

### Filtering applied during import

`import-ojk.ts` filters out entities where:

- `value` is shorter than 5 characters
- `value` is longer than 200 characters
- `value` is all zeros
- `value` contains known non-fraud domains (`ojk`, `supabase`, `google`, `facebook`)

This removes the most common false positives from regex-based extraction.

### Manual review

For high-stakes use (selling API access to fintechs), review the data before import:

```bash
npm run scrape:ojk
# Open data/ojk-scraped.json and review
# Remove obvious false positives
npm run import:ojk
```

---

## Adding new data sources

To add a new scraper source, add an entry to the `SOURCES` array in `scripts/scrape-ojk.ts`:

```typescript
{
  name: "New Source Name",
  url: "https://example.com/fraud-list",
  selector: "table tbody tr",
  parse: ($, row): ScrapedEntity | null => {
    const cells = $(row).find("td");
    const value = $(cells[1]).text().trim();
    if (!value) return null;
    return {
      type: detectType(value),
      value,
      scam_type: "Transfer Penipuan",
      source: "New Source Name",
      scraped_at: new Date().toISOString(),
    };
  },
}
```

The `detectType()` helper classifies values automatically based on their format:

- Starts with `08` or `+62` → `phone`
- Contains `.com`, `.id`, `.net`, etc. → `domain`
- Contains `gopay`, `ovo`, `dana` → `ewallet`
- Everything else → `bank_account`

---

## Future: automated refresh

The current workflow is manual (run scripts locally). For automated refreshes, the right approach is a Vercel Cron Job or a GitHub Actions scheduled workflow:

```yaml
# .github/workflows/refresh.yml
on:
  schedule:
    - cron: "0 2 * * 1" # Every Monday at 2am
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run scrape:ojk
      - run: npm run import:ojk
    env:
      NEXT_PUBLIC_SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
      SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

This would keep the database fresh without manual intervention.
