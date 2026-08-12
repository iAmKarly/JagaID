-- ─────────────────────────────────────────────────────────────────────────────
-- JagaID — Initial Schema
-- Run via: supabase db push
-- Or paste into Supabase SQL editor
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable UUID generation
create extension if not exists "uuid-ossp";

-- ── Entity types ──────────────────────────────────────────────────────────────
create type entity_type as enum ('bank_account', 'phone', 'ewallet', 'domain');

create type scam_type as enum (
  'Transfer Penipuan',
  'Investasi Bodong',
  'Phishing',
  'COD Palsu',
  'Pinjol Ilegal',
  'Belanja Online',
  'Lowongan Kerja Palsu',
  'Lainnya'
);

-- ── Entities table ────────────────────────────────────────────────────────────
create table if not exists entities (
  id          text primary key default uuid_generate_v4()::text,
  type        entity_type not null,
  value       text not null,
  bank        text,
  reports     integer not null default 0,
  last_seen   date not null default current_date,
  created_at  timestamptz not null default now(),

  constraint entities_value_not_empty check (length(trim(value)) > 0)
);

-- Normalised lookup index — fast case-insensitive search
create index if not exists idx_entities_value_lower
  on entities (lower(trim(value)));

create index if not exists idx_entities_type
  on entities (type);

create index if not exists idx_entities_last_seen
  on entities (last_seen desc);

-- ── Connections table (graph edges) ──────────────────────────────────────────
create table if not exists connections (
  id          uuid primary key default uuid_generate_v4(),
  from_id     text not null references entities(id) on delete cascade,
  to_id       text not null references entities(id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint connections_no_self_loop check (from_id <> to_id),
  constraint connections_unique unique (from_id, to_id)
);

create index if not exists idx_connections_from on connections (from_id);
create index if not exists idx_connections_to   on connections (to_id);

-- ── Reports table ─────────────────────────────────────────────────────────────
create table if not exists reports (
  id          text primary key default uuid_generate_v4()::text,
  entity_id   text not null references entities(id) on delete cascade,
  type        scam_type not null default 'Lainnya',
  amount      text,
  date        date not null default current_date,
  description text not null,
  created_at  timestamptz not null default now(),

  constraint reports_description_not_empty check (length(trim(description)) >= 10)
);

create index if not exists idx_reports_entity_id  on reports (entity_id);
create index if not exists idx_reports_type        on reports (type);
create index if not exists idx_reports_date        on reports (date desc);

-- ── Auto-increment report count trigger ───────────────────────────────────────
create or replace function increment_entity_report_count()
returns trigger language plpgsql as $$
begin
  update entities
  set
    reports   = reports + 1,
    last_seen = new.date
  where id = new.entity_id;
  return new;
end;
$$;

create trigger trg_increment_report_count
  after insert on reports
  for each row execute function increment_entity_report_count();

-- ── Row-level security (public read, authenticated write) ─────────────────────
alter table entities enable row level security;
alter table reports   enable row level security;
alter table connections enable row level security;

-- Anyone can read
create policy "Public read entities"
  on entities for select using (true);

create policy "Public read reports"
  on reports for select using (true);

create policy "Public read connections"
  on connections for select using (true);

-- Only authenticated users (or service role) can insert
create policy "Auth insert entities"
  on entities for insert
  with check (true); -- tighten with auth.role() = 'authenticated' in production

create policy "Auth insert reports"
  on reports for insert
  with check (true);

-- ── Helper view: entity risk summary ─────────────────────────────────────────
create or replace view entity_risk_summary as
select
  e.id,
  e.type,
  e.value,
  e.bank,
  e.reports,
  e.last_seen,
  e.created_at,
  (
    select count(*) from connections c
    where c.from_id = e.id or c.to_id = e.id
  ) as connection_count,
  -- Simple server-side risk score for SQL-level queries
  least(
    (e.reports * 4)
    + ((select count(*) from connections c where c.from_id = e.id or c.to_id = e.id) * 8)
    + case
        when e.last_seen >= current_date - interval '30 days' then 15
        when e.last_seen >= current_date - interval '90 days' then 8
        else 0
      end,
    100
  ) as risk_score
from entities e;
