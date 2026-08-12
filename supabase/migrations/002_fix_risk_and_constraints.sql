-- ─────────────────────────────────────────────────────────────────────────────
-- JagaID — Migration 002: Risk view + write constraints
-- Run via: supabase db push (or paste into Supabase SQL editor)
--
-- Changes:
--   a) UNIQUE(type, value) on entities — required for admin upsert + dedupe
--   b) Lock down RLS write policies — only service_role can insert
--   c) Reconcile entity_risk_summary view with src/lib/risk.ts (per-component caps)
-- ─────────────────────────────────────────────────────────────────────────────

-- a) Unique constraint on (type, value)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'entities_type_value_unique'
  ) then
    alter table entities add constraint entities_type_value_unique unique (type, value);
  end if;
end$$;

-- b) Lock down RLS write policies — drop the open ones, allow only service_role
drop policy if exists "Auth insert entities" on entities;
drop policy if exists "Auth insert reports"   on reports;

drop policy if exists "Service role insert entities"    on entities;
drop policy if exists "Service role insert reports"     on reports;
drop policy if exists "Service role insert connections" on connections;

create policy "Service role insert entities"
  on entities for insert to service_role with check (true);

create policy "Service role insert reports"
  on reports for insert to service_role with check (true);

create policy "Service role insert connections"
  on connections for insert to service_role with check (true);

-- c) Fix entity_risk_summary view to match src/lib/risk.ts (per-component caps)
--    reportScore  = least(reports * 4, 60)
--    networkScore = least(connection_count * 8, 24)
--    recencyScore = 15 if last_seen within 30d AND not in the future,
--                    8 if last_seen within 90d AND not in the future,
--                    0 otherwise (mirrors lib/risk.ts negative-clamp)
--    score = least(sum, 100)
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
  ) as risk_score
from entities e;
