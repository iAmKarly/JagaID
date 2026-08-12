-- ─────────────────────────────────────────────────────────────────────────────
-- JagaID — Migration 003: Lookup index, source/confidence tracking, report dedup
--
-- Why each change:
--   a) idx_entities_value — current `idx_entities_value_lower` is on
--      lower(trim(value)), but we already normalise values at write time
--      via normalizeQuery(), so dbLookup queries `value = q` directly.
--      That doesn't match the function index, and the UNIQUE(type, value)
--      btree from migration 002 has `type` as its leading column — also
--      unusable for `WHERE value = q`. So at scale every lookup was a seq
--      scan. This adds the index that actually matches.
--
--   b) source / confidence — entities and reports can come from community
--      submissions, OJK scrapes, manual CSV imports, partner APIs.
--      Track where each row came from so we can:
--        - filter low-confidence rows out of public results
--        - audit which sources are most accurate
--        - eventually weight risk score by source
--
--   c) submitter_ip_hash + partial unique index — prevent the same IP from
--      flooding /api/report for the same entity on the same day. The DB
--      enforces the limit; the API just catches the unique-violation.
--      Hash, not raw IP, to keep the table privacy-friendly.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── a) Lookup index that matches the actual query shape ─────────────────────
-- dbLookup runs `.eq("value", q)` after normalising q.
-- The function index from 001 doesn't help; this one does.
create index if not exists idx_entities_value on entities (value);

-- The function index is now redundant — values are pre-normalised at write.
drop index if exists idx_entities_value_lower;

-- ── b) Source + confidence on entities and reports ──────────────────────────
-- Backfill defaults:
--   'community' (100) — submitted via /api/report
--   'admin'     (90)  — uploaded via /api/admin/upload
--   'ojk'       (40)  — scraped from OJK alert portal (high source authority but
--                       regex-extracted, so medium confidence pending review)
--   'scrape'    (20)  — body-text extraction; treat as untrusted until reviewed
-- Confidence is stored 0–100 so it can be used as a multiplier later.

alter table entities  add column if not exists source     text     not null default 'community';
alter table entities  add column if not exists confidence smallint not null default 100
  constraint entities_confidence_range  check (confidence between 0 and 100);

alter table reports   add column if not exists source     text     not null default 'community';
alter table reports   add column if not exists confidence smallint not null default 100
  constraint reports_confidence_range   check (confidence between 0 and 100);

create index if not exists idx_entities_source on entities (source);
create index if not exists idx_reports_source  on reports  (source);

-- ── c) Submitter hash + per-day per-IP per-entity dedup ─────────────────────
-- The hash itself is whatever the API computes (recommended: SHA-256 of
-- ip + a server-side salt). Stored as text so we never see the raw IP.
alter table reports add column if not exists submitter_ip_hash text;

-- Partial unique: only enforce when the hash is present. Old rows (and any
-- ingested without a hash, e.g. CSV imports) are never blocked.
create unique index if not exists idx_reports_dedup
  on reports (entity_id, submitter_ip_hash, date)
  where submitter_ip_hash is not null;

-- ── d) Refresh the risk view to expose source & confidence ──────────────────
-- The risk formula itself is unchanged — keep parity with src/lib/risk.ts.
-- We just surface source/confidence so dashboards can filter by them.
--
-- IMPORTANT: CREATE OR REPLACE VIEW cannot rename or reorder existing
-- columns. The view from migration 002 ends with `..., connection_count,
-- risk_score`. Appending `source` and `confidence` AFTER risk_score keeps
-- positions 1..9 stable so Postgres accepts the replace.
create or replace view entity_risk_summary as
select
  e.id, e.type, e.value, e.bank, e.reports, e.last_seen, e.created_at,
  (select count(*) from connections c where c.from_id = e.id or c.to_id = e.id) as connection_count,
  least(
    least(e.reports * 4, 60)
    + least((select count(*) from connections c where c.from_id = e.id or c.to_id = e.id) * 8, 24)
    + case
        when e.last_seen > current_date then 0
        when e.last_seen >= current_date - interval '30 days' then 15
        when e.last_seen >= current_date - interval '90 days' then 8
        else 0
      end,
    100
  ) as risk_score,
  e.source,
  e.confidence
from entities e;
