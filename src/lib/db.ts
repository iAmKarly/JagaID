/**
 * src/lib/db.ts
 *
 * All database reads/writes go through here.
 *
 * Two env vars control the mode:
 *
 *   USE_SUPABASE=true              Server-only, read at request time (runtime).
 *                                  Set this in .env.test for local e2e testing.
 *                                  The shell script exports it before starting
 *                                  the dev server so it works without a rebuild.
 *
 *   NEXT_PUBLIC_USE_SUPABASE=true  Baked into the JS bundle at build time.
 *                                  Set this in Vercel env vars for production.
 *
 * Either one being "true" activates Supabase mode.
 * If neither is set (or both are "false"), falls back to in-memory SEED_DB.
 */

import {
  Entity,
  EntityWithRisk,
  Report,
  Database,
  LookupResponse,
  ReportPayload,
} from "@/types";
import { lookup as lookupLocal, normalizeQuery } from "./lookup";
import { calcRisk } from "./risk";
import { SEED_DB } from "./seed-data";

// Re-evaluated on every call — never cached at module level.
// This is critical: module-level constants are frozen at first import in Next.js.
// USE_SUPABASE must be read fresh on each request so the shell script's exported
// env vars (set after the module may have first loaded) take effect correctly.
function isSupabaseMode(): boolean {
  return (
    process.env.USE_SUPABASE === "true" || process.env.NEXT_PUBLIC_USE_SUPABASE === "true"
  );
}

/**
 * Build an EntityWithRisk from an entity_risk_summary view row.
 *
 * The view exposes `connection_count` and a precomputed `risk_score`. We
 * reconstruct an Entity shape so calcRisk can produce the structured
 * RiskResult (with breakdown). The resulting score MUST equal row.risk_score
 * — that invariant is enforced by tests/unit/risk-parity.test.ts and the
 * formula in migration 003's view.
 *
 * The synthesised `connected` array has length = connection_count but its
 * contents are placeholder — calcRisk only reads `.length`. The returned
 * object then sets `connected: []` since the client never uses the IDs.
 */
function fromViewRow(
  row: Entity & { connection_count?: number; risk_score?: number }
): EntityWithRisk {
  const stub: Entity = {
    ...row,
    connected: new Array(row.connection_count ?? 0).fill(""),
  };
  const risk = calcRisk(stub);
  return { ...row, connected: [], risk };
}

// ── READ: lookup an entity ────────────────────────────────────────────────────
export async function dbLookup(query: string): Promise<LookupResponse> {
  if (!isSupabaseMode()) return lookupLocal(query, SEED_DB);

  const { supabase } = await import("./supabase");
  const db = supabase();
  const q = normalizeQuery(query);
  if (!q) return { found: false };

  const { data: entities, error } = await db
    .from("entities")
    .select("*")
    .eq("value", q)
    .limit(1);

  if (error) throw new Error(`Supabase lookup failed: ${error.message}`);
  if (!entities || entities.length === 0) return { found: false };

  const entity = entities[0] as unknown as Entity;

  const { data: reports } = await db
    .from("reports")
    .select("*")
    .eq("entity_id", entity.id)
    .order("date", { ascending: false })
    .limit(10);

  const { data: connections } = await db
    .from("connections")
    .select("from_id, to_id")
    .or(`from_id.eq.${entity.id},to_id.eq.${entity.id}`);

  const connectedIds = (connections ?? []).map((c: { from_id: string; to_id: string }) =>
    c.from_id === entity.id ? c.to_id : c.from_id
  );

  // Pull network entities through the risk view so each one carries its own
  // (correct) precomputed risk. The previous code stubbed connected: [] which
  // caused calcRisk to under-count network score for these neighbours; reading
  // from the view fixes that latent bug.
  const { data: networkRows } =
    connectedIds.length > 0
      ? await db.from("entity_risk_summary").select("*").in("id", connectedIds)
      : { data: [] };

  const network = (networkRows ?? []).map((r) =>
    fromViewRow(r as Entity & { connection_count: number; risk_score: number })
  );

  const entityWithConnections: Entity = { ...entity, connected: connectedIds };
  const risk = calcRisk(entityWithConnections);

  return {
    found: true,
    entity: entityWithConnections,
    risk,
    reports: (reports ?? []) as Report[],
    network,
  };
}

// ── WRITE: submit a report ────────────────────────────────────────────────────
export async function dbSubmitReport(
  payload: ReportPayload,
  meta?: { ipHash?: string }
): Promise<{ entity_id: string }> {
  if (!isSupabaseMode()) {
    const normalizedValue = normalizeQuery(payload.value);
    const existing = SEED_DB.entities.find(
      (e) => normalizeQuery(e.value) === normalizedValue
    );
    let entityId: string;
    if (existing) {
      entityId = existing.id;
      existing.reports += 1;
      existing.last_seen = new Date().toISOString().split("T")[0];
    } else {
      entityId = `e_${Date.now()}`;
      SEED_DB.entities.push({
        id: entityId,
        type: payload.type,
        value: normalizedValue,
        bank: payload.bank,
        reports: 1,
        connected: [],
        last_seen: new Date().toISOString().split("T")[0],
      });
    }
    SEED_DB.reports.push({
      id: `r_${Date.now()}`,
      entity_id: entityId,
      type: payload.scam_type,
      amount: payload.amount,
      date: new Date().toISOString().split("T")[0],
      description: payload.description,
    });
    return { entity_id: entityId };
  }

  const { supabaseAdmin } = await import("./supabase");
  const db = supabaseAdmin();
  const today = new Date().toISOString().split("T")[0];
  const normalizedValue = normalizeQuery(payload.value);

  const { data: existing } = await db
    .from("entities")
    .select("id")
    .eq("value", normalizedValue)
    .limit(1);

  let entityId: string;

  if (existing && existing.length > 0) {
    entityId = existing[0].id;
    await db.from("entities").update({ last_seen: today }).eq("id", entityId);
  } else {
    const { data, error } = await db
      .from("entities")
      .insert({
        type: payload.type,
        value: normalizedValue,
        bank: payload.bank ?? null,
        reports: 0,
        last_seen: today,
        source: "community",
        confidence: 100,
      })
      .select("id")
      .single();
    if (error) throw new Error(`Entity insert failed: ${error.message}`);
    entityId = data.id;
  }

  const { error: reportError } = await db.from("reports").insert({
    entity_id: entityId,
    type: payload.scam_type,
    amount: payload.amount ?? null,
    date: today,
    description: payload.description,
    source: "community",
    confidence: 100,
    submitter_ip_hash: meta?.ipHash ?? null,
  });

  if (reportError) {
    // Postgres unique-violation = same IP submitting same entity same day.
    // Surface as a domain-specific error so the route can return 429.
    if (reportError.code === "23505") {
      throw new DuplicateReportError("Anda sudah melaporkan entitas ini hari ini.");
    }
    throw new Error(`Report insert failed: ${reportError.message}`);
  }
  return { entity_id: entityId };
}

/** Thrown by dbSubmitReport when the per-day per-IP per-entity dedup index
 *  rejects the insert. Routes catch this and return 429. */
export class DuplicateReportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DuplicateReportError";
  }
}

// ── READ: dashboard stats ─────────────────────────────────────────────────────
export async function dbGetStats(): Promise<{
  totalReports: number;
  totalEntities: number;
  highRiskCount: number;
  bankCount: number;
}> {
  if (!isSupabaseMode()) {
    return {
      totalReports: SEED_DB.reports.length,
      totalEntities: SEED_DB.entities.length,
      highRiskCount: SEED_DB.entities.filter((e) => calcRisk(e).score >= 80).length,
      bankCount: SEED_DB.entities.filter((e) => e.type === "bank_account").length,
    };
  }

  const { supabase } = await import("./supabase");
  const db = supabase();

  const [
    { count: totalReports },
    { count: totalEntities },
    { count: bankCount },
    { count: highRiskCount },
  ] = await Promise.all([
    db.from("reports").select("*", { count: "exact", head: true }),
    db.from("entities").select("*", { count: "exact", head: true }),
    db
      .from("entities")
      .select("*", { count: "exact", head: true })
      .eq("type", "bank_account"),
    db
      .from("entity_risk_summary")
      .select("*", { count: "exact", head: true })
      .gte("risk_score", 80),
  ]);

  return {
    totalReports: totalReports ?? 0,
    totalEntities: totalEntities ?? 0,
    highRiskCount: highRiskCount ?? 0,
    bankCount: bankCount ?? 0,
  };
}

// ── READ: top dangerous entities (with risk attached) ─────────────────────────
export async function dbGetTopEntities(limit = 5): Promise<EntityWithRisk[]> {
  if (!isSupabaseMode()) {
    return [...SEED_DB.entities]
      .map((e) => ({ ...e, risk: calcRisk(e) }))
      .sort((a, b) => b.risk.score - a.risk.score)
      .slice(0, limit);
  }

  const { supabase } = await import("./supabase");
  const db = supabase();

  // Read from the risk view directly — it already has risk_score AND
  // connection_count, so a single query gives us everything. The previous
  // implementation paged a second query for connections and recomputed risk
  // on the client; both unnecessary now.
  const { data } = await db
    .from("entity_risk_summary")
    .select("*")
    .order("risk_score", { ascending: false })
    .limit(limit);

  return (data ?? []).map((r) =>
    fromViewRow(r as Entity & { connection_count: number; risk_score: number })
  );
}

// ── READ: full database snapshot ──────────────────────────────────────────────
export async function dbGetDatabase(): Promise<Database> {
  if (!isSupabaseMode()) return SEED_DB;

  const { supabase } = await import("./supabase");
  const db = supabase();

  const [{ data: entities }, { data: reports }, { data: connections }] =
    await Promise.all([
      db.from("entities").select("*").limit(500),
      db.from("reports").select("*").limit(2000),
      db.from("connections").select("*").limit(2000),
    ]);

  const entityMap = new Map(
    (entities ?? []).map((e) => [e.id, { ...e, connected: [] as string[] }])
  );
  (connections ?? []).forEach((c: { from_id: string; to_id: string }) => {
    entityMap.get(c.from_id)?.connected?.push(c.to_id);
    entityMap.get(c.to_id)?.connected?.push(c.from_id);
  });

  return {
    entities: [...entityMap.values()] as Entity[],
    reports: (reports ?? []) as Report[],
  };
}
