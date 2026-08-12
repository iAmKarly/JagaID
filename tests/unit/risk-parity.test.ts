/**
 * Asserts that the SQL `entity_risk_summary` view formula matches `lib/risk.ts`.
 * The view lives in supabase/migrations/002_fix_risk_and_constraints.sql — if you
 * change one, change the other. This test computes the view formula in JS and
 * compares against calcRiskScore for a sample of entities.
 */
import { calcRiskScore } from "@/lib/risk";
import { Entity } from "@/types";

function viewRiskScore(entity: Entity): number {
  const reportScore = Math.min(entity.reports * 4, 60);
  const networkScore = Math.min((entity.connected ?? []).length * 8, 24);
  const daysSince = Math.floor(
    (Date.now() - new Date(entity.last_seen).getTime()) / 86_400_000
  );
  // Mirror SQL view exactly:
  //   when last_seen > current_date            then 0
  //   when last_seen >= current_date - 30 days then 15
  //   when last_seen >= current_date - 90 days then 8
  //   else 0
  let recencyScore: number;
  if (daysSince < 0) recencyScore = 0;
  else if (daysSince < 30) recencyScore = 15;
  else if (daysSince < 90) recencyScore = 8;
  else recencyScore = 0;
  return Math.min(reportScore + networkScore + recencyScore, 100);
}

const today = new Date().toISOString().split("T")[0];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0];

const samples: Entity[] = [
  { id: "a", type: "bank_account", value: "1234567890", reports: 15, connected: ["x", "y", "z"], last_seen: today },
  { id: "b", type: "phone",        value: "08123",      reports: 0,  connected: [],              last_seen: daysAgo(200) },
  { id: "c", type: "domain",       value: "scam.com",   reports: 5,  connected: ["x"],           last_seen: daysAgo(60) },
  { id: "d", type: "ewallet",      value: "gopay:1",    reports: 100, connected: Array(50).fill("x"), last_seen: today }, // caps test
  { id: "e", type: "bank_account", value: "9999",       reports: 1,  connected: [],              last_seen: daysAgo(89) },
  // Future date — must give recency=0 in both TS and SQL
  { id: "f", type: "bank_account", value: "8888",       reports: 5,  connected: ["x"],           last_seen: daysAgo(-7) },
];

describe("risk parity (SQL view ↔ TS calcRisk)", () => {
  it.each(samples)("agrees on entity %#", (entity) => {
    const ts = calcRiskScore(entity).score;
    const sql = viewRiskScore(entity);
    expect(ts).toBe(sql);
  });
});
