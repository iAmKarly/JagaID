import { Database, Entity, EntityWithRisk, LookupResponse, Report } from "@/types";
import { calcRisk } from "./risk";

/**
 * Normalises an entity value or query for storage and lookup.
 *
 * Steps (in order):
 *   1. trim + lowercase
 *   2. strip URL prefix `http(s)://`        ─┐
 *   3. strip leading `www.`                  │  so `https://www.investasi-cepat.com/path?ref=foo`
 *   4. strip path/query/hash (`/`, `?`, `#`) │  becomes `investasicepat.com`
 *   5. strip whitespace and dashes          ─┘
 *
 * The result is what we store in `entities.value` and what `dbLookup` queries
 * with `.eq("value", q)`. Stored values therefore never contain spaces, dashes,
 * URL prefixes, or paths — pasting any reasonable form of a domain still hits.
 */
export function normalizeQuery(query: string): string {
  return query
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/?#].*$/, "")
    .replace(/[\s\-]/g, "");
}

export function matchesEntity(entity: Entity, query: string): boolean {
  return normalizeQuery(entity.value) === normalizeQuery(query);
}

export function findEntity(query: string, db: Database): Entity | undefined {
  const q = normalizeQuery(query);
  if (!q) return undefined;
  return db.entities.find((e) => matchesEntity(e, q));
}

export function getEntityReports(entityId: string, db: Database): Report[] {
  return db.reports.filter((r) => r.entity_id === entityId);
}

export function getEntityNetwork(entity: Entity, db: Database): EntityWithRisk[] {
  // Each network member's risk is computed at retrieval time so the client
  // never has to reach for calcRisk. In Supabase mode the equivalent shape is
  // produced from the entity_risk_summary view.
  return db.entities
    .filter((e) => (entity.connected ?? []).includes(e.id))
    .map((e) => ({ ...e, risk: calcRisk(e) }));
}

export function lookup(query: string, db: Database): LookupResponse {
  const entity = findEntity(query, db);
  if (!entity) return { found: false };

  const risk = calcRisk(entity);
  const reports = getEntityReports(entity.id, db);
  const network = getEntityNetwork(entity, db);

  return { found: true, entity, risk, reports, network };
}
