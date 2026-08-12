# API Reference

JagaID exposes a public REST API. All endpoints return JSON.

Base URL: `https://your-app.vercel.app`

---

## Public endpoints

### `GET /api/check`

Check whether a bank account, phone number, e-wallet, or domain has been reported for fraud.

**Lookup is exact-match only.** The `q` parameter is normalized server-side via `normalizeQuery` (trim → lowercase → strip whitespace and dashes) and compared with `.eq()`. Substring matches and SQL `%/_` wildcards are intentionally disabled. A query for `123` will NOT match `1234567890`.

**Query parameters**

| Parameter | Required | Description |
|---|---|---|
| `q` | Yes | The value to check. 5–200 characters before normalization. Whitespace, dashes, and case are ignored: `1234-567 890` and `1234567890` lookup the same row. |

**Example request**

```bash
curl "https://jagaid.app/api/check?q=1234567890"
```

**Response — found**

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
    "last_seen": "2024-12-01",
    "created_at": "2024-01-15T10:30:00Z"
  },
  "risk": {
    "score": 99,
    "label": "BAHAYA TINGGI",
    "color": "#ff2d2d",
    "breakdown": {
      "reportScore": 60,
      "networkScore": 24,
      "recencyScore": 15
    }
  },
  "reports": [
    {
      "id": "r1",
      "entity_id": "e1",
      "type": "Transfer Penipuan",
      "amount": "Rp 2.500.000",
      "date": "2024-12-01",
      "description": "Modus COD palsu, barang tidak dikirim setelah transfer."
    }
  ],
  "network": [
    { "id": "e2", "type": "phone",        "value": "08123456789",       "reports": 9, "connected": [], "last_seen": "2024-11-28" },
    { "id": "e3", "type": "ewallet",      "value": "gopay:08123456789", "reports": 5, "connected": [], "last_seen": "2024-10-30" },
    { "id": "e5", "type": "domain",       "value": "investasicepat.com","reports": 22, "connected": [], "last_seen": "2024-12-05" }
  ]
}
```

`network` items have `connected: []` — only the queried entity carries its full connection list. The `value` of stored entities is in normalized form (no spaces, no dashes, lowercase). The UI displays the stored value verbatim.

**Response — not found**

```json
{
  "found": false
}
```

The status is still `200`. Treat the response shape as the contract; don't rely on the status code to distinguish found from not-found.

**Error responses**

| Status | Condition |
|---|---|
| 400 | `q` is missing or shorter than 5 characters (after trim) |
| 500 | Database error |

**Risk score labels**

| Label | Score range | Meaning |
|---|---|---|
| `BAHAYA TINGGI` | 80–100 | High danger — multiple reports, connected network |
| `MENCURIGAKAN` | 50–79 | Suspicious — significant report volume or connections |
| `WASPADA` | 20–49 | Caution — some reports, worth investigating |
| `AMAN` | 0–19 | No significant reports found |

Score formula:
- `reportScore = min(reports × 4, 60)`
- `networkScore = min(connections × 8, 24)`
- `recencyScore = 15` if `last_seen` within 30 days (and not in the future); `8` if within 90 days; else `0`
- `score = min(reportScore + networkScore + recencyScore, 100)`

---

### `POST /api/report`

Submit a fraud report.

**Request body** (JSON)

```json
{
  "type": "bank_account",
  "value": "1234567890",
  "bank": "BRI",
  "scam_type": "Transfer Penipuan",
  "amount": "Rp 2.500.000",
  "description": "Pelaku mengaku penjual online lalu menghilang setelah transfer."
}
```

**Fields**

| Field | Required | Type | Constraints |
|---|---|---|---|
| `type` | Yes | string | `bank_account`, `phone`, `ewallet`, `domain` |
| `value` | Yes | string | 5–200 characters before normalization. Stored as `normalizeQuery(value)` — trimmed, lowercased, whitespace and `-` stripped. Existing entries are matched via exact-match on the normalized form |
| `bank` | No | string | Bank name (for `bank_account` type) |
| `scam_type` | Yes | string | See valid values below |
| `amount` | No | string | Loss amount, free text (e.g. "Rp 2.500.000") |
| `description` | Yes | string | 10–2000 characters, trimmed |

**Valid `scam_type` values**

- `Transfer Penipuan`
- `Investasi Bodong`
- `Phishing`
- `COD Palsu`
- `Pinjol Ilegal`
- `Belanja Online`
- `Lowongan Kerja Palsu`
- `Lainnya`

**Example request**

```bash
curl -X POST "https://jagaid.app/api/report" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "bank_account",
    "value": "1234-567 890",
    "bank": "BRI",
    "scam_type": "Transfer Penipuan",
    "description": "Pelaku mengaku penjual online lalu menghilang setelah transfer."
  }'
```

The `value` `"1234-567 890"` is stored as `"1234567890"` (normalized). If a row with `(type=bank_account, value="1234567890")` already exists, this insert appends a new report to it and updates `last_seen`; otherwise a new entity is created.

**Response — 201 Created**

```json
{
  "success": true,
  "entity_id": "e1"
}
```

**Error responses**

| Status | Condition |
|---|---|
| 400 | Invalid JSON body |
| 422 | Validation failed — response includes `error.fieldErrors` and `error.formErrors` from Zod's `.flatten()` |
| 500 | Database error |

---

### `GET /api/stats`

Returns aggregate statistics for the dashboard.

**Example request**

```bash
curl "https://jagaid.app/api/stats"
```

**Response — 200 OK**

```json
{
  "stats": {
    "totalReports": 1247,
    "totalEntities": 892,
    "highRiskCount": 134,
    "bankCount": 445
  },
  "topEntities": [
    {
      "id": "e5",
      "type": "domain",
      "value": "investasicepat.com",
      "reports": 22,
      "connected": ["e1"],
      "last_seen": "2024-12-05"
    }
  ]
}
```

`topEntities` contains up to 5 entities sorted by risk score descending. Each entity carries its real `connected` array so the client can recompute `calcRisk()` and get the same score the SQL view used for sorting.

**Error responses**

| Status | Condition |
|---|---|
| 500 | Database error (returned as `{"error": "Database error"}`) |

---

## Admin endpoints

These endpoints require the `x-admin-key` request header set to your `ADMIN_UPLOAD_KEY` environment variable. `/api/admin/upload` also accepts an `?admin_key=...` query-string fallback (for legacy clients), but the header is preferred — query strings leak into server logs.

### `POST /api/admin/upload`

Bulk-import fraud entities from a CSV file. Uses `csv-parse/sync` so quoted values with embedded commas, CRLF endings, and irregular column counts are handled correctly.

Each row's `value` is normalized via `normalizeQuery` (trim → lowercase → strip whitespace and `-`) before insert. Upsert keys on `(type, value)` thanks to the `entities_type_value_unique` constraint added in migration 002 — re-running the same CSV is a safe no-op for entity rows (a new report row is still inserted per upload, intentionally, to record the most recent provenance).

**Headers**

```
x-admin-key: <your-admin-key>
Content-Type: multipart/form-data        # or text/plain for raw body
```

**Body** — multipart form with a `file` field, OR raw CSV as the body.

**CSV columns** (header row required, case-insensitive):
- `type` — one of `bank_account`, `phone`, `ewallet`, `domain` (synonyms like `hp`, `gopay`, `url` are mapped automatically)
- `value` — the entity value (will be normalized)
- `bank` — optional, used for `bank_account`
- `scam_type` — optional; defaults to `Lainnya`. Free-text matches like "investasi", "phish" are mapped to enum values

```bash
curl -X POST "https://jagaid.app/api/admin/upload" \
  -H "x-admin-key: your-admin-key" \
  -F "file=@data/ojk-data.csv"
```

Or send raw CSV as the body:

```bash
curl -X POST "https://jagaid.app/api/admin/upload" \
  -H "x-admin-key: your-admin-key" \
  -H "Content-Type: text/plain" \
  --data-binary @data/ojk-data.csv
```

**Response — 200 OK**

```json
{
  "success": true,
  "summary": {
    "total_rows": 150,
    "inserted": 147,
    "skipped": 3,
    "errors": ["Batch 2: ..."]
  }
}
```

`errors` is omitted when the array is empty.

**Error responses**

| Status | Condition |
|---|---|
| 400 | No file uploaded (multipart), empty CSV body, or zero valid rows after parsing |
| 401 | Missing or incorrect `x-admin-key` |
| 500 | Database error |

---

### `DELETE /api/admin/reset`

Delete all rows from `reports`, `connections`, and `entities`. Irreversible. Schema and migrations are not affected.

**Headers**

```
x-admin-key: <your-admin-key>
```

```bash
curl -X DELETE "https://jagaid.app/api/admin/reset" \
  -H "x-admin-key: your-admin-key"
```

**Response — 200 OK**

```json
{
  "success": true,
  "deleted": {
    "reports": 1247,
    "connections": 83,
    "entities": 892
  }
}
```

**Error responses**

| Status | Condition |
|---|---|
| 401 | Missing or incorrect `x-admin-key` |
| 500 | Database error (returned as `{"error": "Failed to delete <table>: <message>"}`) |

---

## Test-only endpoint

### `POST` / `DELETE` `/api/e2e-seed`

Seeds (or removes) a known set of test fixtures. Used by the Playwright suite (`tests/e2e/global-teardown.ts`, `scripts/test-e2e-supabase.sh`). Disabled unless `E2E_SEED_KEY` is set in the environment.

**Headers**

```
x-e2e-key: <value of E2E_SEED_KEY>
```

There is **no** query-string fallback — the key must be in the header.

`POST` inserts `e2e_1`–`e2e_5` entities, 3 connections, and 17 reports. The `e2e_1` entity (bank_account `1234567890`) is guaranteed to score 99 (BAHAYA TINGGI) — 60 report points + 24 network points + 15 recency points.

`DELETE` removes everything with an `e2e_*` prefix.

**Error responses**

| Status | Condition |
|---|---|
| 401 | Missing or incorrect `x-e2e-key` |
| 500 | Database error |

Do not enable `E2E_SEED_KEY` in production. Setting it leaves a server-side write endpoint open to anyone who knows the secret.

---

## CORS

CORS is **opt-in**. With no configuration, the API has no `Access-Control-Allow-Origin` header — same-origin requests work, cross-origin requests fail. This is the safest default for a single-domain app.

To allow a specific cross-origin domain (e.g. an embed widget or partner fintech), set `ALLOWED_ORIGIN=https://example.com` as an environment variable. Then:

- `next.config.js` adds `Access-Control-Allow-Origin`, `Allow-Methods` (`GET, POST, DELETE, OPTIONS`), and `Allow-Headers` (`Content-Type, x-admin-key, x-e2e-key`) to every `/api/*` response.
- `src/middleware.ts` answers preflight `OPTIONS` requests with `204 No Content` if the request `Origin` matches `ALLOWED_ORIGIN`. Mismatched origins receive `403`.

Wildcard (`*`) origins are not supported; use exactly one domain. If you need multiple, run a reverse proxy or extend the middleware to accept a comma-separated list.

## Security headers

Every response (not just `/api/*`) ships:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `Content-Security-Policy` — locks scripts and styles to self plus Google Fonts and Supabase. In production, no `'unsafe-eval'` is allowed; in dev, `'unsafe-eval'` and `ws://localhost:*` are added so Next HMR can run.

## Rate limiting

The API currently has no rate limiting — this is on the roadmap (Upstash Redis). If you're integrating, cache lookups client-side and back off on 5xx.

## Fintech integration example

```javascript
async function checkAccount(accountNumber) {
  const res = await fetch(
    `https://jagaid.app/api/check?q=${encodeURIComponent(accountNumber)}`
  );
  const data = await res.json();

  if (!data.found) return { safe: true, score: 0 };

  return {
    safe: data.risk.score < 50,
    score: data.risk.score,
    label: data.risk.label,
    reports: data.entity.reports,
    networkSize: data.network.length,
  };
}
```
