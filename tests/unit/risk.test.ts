import {
  calcRisk,
  calcRiskScore,
  calcRecencyScore,
  getRiskLabel,
  getRiskColor,
  RISK_WEIGHTS,
} from "@/lib/risk";
import { Entity } from "@/types";

// ── Helpers ────────────────────────────────────────────────────────────────
function makeEntity(overrides: Partial<Entity> = {}): Entity {
  return {
    id: "test-1",
    type: "bank_account",
    value: "1234567890",
    bank: "BRI",
    reports: 0,
    connected: [],
    last_seen: new Date().toISOString().split("T")[0],
    ...overrides,
  };
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0];
}

// ── calcRecencyScore ────────────────────────────────────────────────────────
describe("calcRecencyScore", () => {
  it("returns max score for activity within 30 days", () => {
    expect(calcRecencyScore(daysAgo(1))).toBe(RISK_WEIGHTS.recencyScore.within30Days);
    expect(calcRecencyScore(daysAgo(29))).toBe(RISK_WEIGHTS.recencyScore.within30Days);
  });

  it("returns medium score for activity within 31–89 days", () => {
    expect(calcRecencyScore(daysAgo(31))).toBe(RISK_WEIGHTS.recencyScore.within90Days);
    expect(calcRecencyScore(daysAgo(89))).toBe(RISK_WEIGHTS.recencyScore.within90Days);
  });

  it("returns zero for activity older than 90 days", () => {
    expect(calcRecencyScore(daysAgo(90))).toBe(0);
    expect(calcRecencyScore(daysAgo(365))).toBe(0);
  });

  it("handles today as within 30 days", () => {
    const today = new Date().toISOString().split("T")[0];
    expect(calcRecencyScore(today)).toBe(RISK_WEIGHTS.recencyScore.within30Days);
  });

  it("returns zero for future-dated last_seen (clock skew)", () => {
    const future = new Date(Date.now() + 5 * 86_400_000).toISOString().split("T")[0];
    expect(calcRecencyScore(future)).toBe(0);
  });
});

// ── calcRiskScore ───────────────────────────────────────────────────────────
describe("calcRiskScore", () => {
  it("returns zero score for a clean entity", () => {
    const entity = makeEntity({ reports: 0, connected: [], last_seen: daysAgo(200) });
    const { score, breakdown } = calcRiskScore(entity);
    expect(score).toBe(0);
    expect(breakdown.reportScore).toBe(0);
    expect(breakdown.networkScore).toBe(0);
    expect(breakdown.recencyScore).toBe(0);
  });

  it("caps report score at max", () => {
    const entity = makeEntity({ reports: 999, connected: [], last_seen: daysAgo(200) });
    const { breakdown } = calcRiskScore(entity);
    expect(breakdown.reportScore).toBe(RISK_WEIGHTS.reportScore.max);
  });

  it("caps network score at max", () => {
    const entity = makeEntity({
      reports: 0,
      connected: ["a", "b", "c", "d", "e", "f", "g", "h"],
      last_seen: daysAgo(200),
    });
    const { breakdown } = calcRiskScore(entity);
    expect(breakdown.networkScore).toBe(RISK_WEIGHTS.networkScore.max);
  });

  it("caps total score at 100", () => {
    const entity = makeEntity({ reports: 999, connected: Array(10).fill("x"), last_seen: daysAgo(1) });
    const { score } = calcRiskScore(entity);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("accumulates all three components correctly", () => {
    const entity = makeEntity({ reports: 5, connected: ["a"], last_seen: daysAgo(10) });
    const { breakdown } = calcRiskScore(entity);
    expect(breakdown.reportScore).toBe(5 * RISK_WEIGHTS.reportScore.perReport);
    expect(breakdown.networkScore).toBe(1 * RISK_WEIGHTS.networkScore.perConnection);
    expect(breakdown.recencyScore).toBe(RISK_WEIGHTS.recencyScore.within30Days);
  });
});

// ── getRiskLabel ────────────────────────────────────────────────────────────
describe("getRiskLabel", () => {
  it("labels score 80+ as BAHAYA TINGGI", () => {
    expect(getRiskLabel(80)).toBe("BAHAYA TINGGI");
    expect(getRiskLabel(100)).toBe("BAHAYA TINGGI");
  });

  it("labels score 50–79 as MENCURIGAKAN", () => {
    expect(getRiskLabel(50)).toBe("MENCURIGAKAN");
    expect(getRiskLabel(79)).toBe("MENCURIGAKAN");
  });

  it("labels score 20–49 as WASPADA", () => {
    expect(getRiskLabel(20)).toBe("WASPADA");
    expect(getRiskLabel(49)).toBe("WASPADA");
  });

  it("labels score 0–19 as AMAN", () => {
    expect(getRiskLabel(0)).toBe("AMAN");
    expect(getRiskLabel(19)).toBe("AMAN");
  });
});

// ── getRiskColor ─────────────────────────────────────────────────────────────
describe("getRiskColor", () => {
  it("returns red for BAHAYA TINGGI", () => {
    expect(getRiskColor("BAHAYA TINGGI")).toBe("#ff2d2d");
  });

  it("returns orange for MENCURIGAKAN", () => {
    expect(getRiskColor("MENCURIGAKAN")).toBe("#ff9500");
  });

  it("returns yellow for WASPADA", () => {
    expect(getRiskColor("WASPADA")).toBe("#ffd60a");
  });

  it("returns green for AMAN", () => {
    expect(getRiskColor("AMAN")).toBe("#30d158");
  });
});

// ── calcRisk (integration of all) ─────────────────────────────────────────
describe("calcRisk", () => {
  it("returns a complete RiskResult", () => {
    const entity = makeEntity({ reports: 17, connected: ["a", "b"], last_seen: daysAgo(5) });
    const result = calcRisk(entity);
    expect(result).toHaveProperty("score");
    expect(result).toHaveProperty("label");
    expect(result).toHaveProperty("color");
    expect(result).toHaveProperty("breakdown");
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it("marks a heavily reported entity as BAHAYA TINGGI", () => {
    const entity = makeEntity({ reports: 20, connected: ["a", "b", "c"], last_seen: daysAgo(1) });
    const result = calcRisk(entity);
    expect(result.label).toBe("BAHAYA TINGGI");
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("marks a clean entity as AMAN", () => {
    const entity = makeEntity({ reports: 0, connected: [], last_seen: daysAgo(300) });
    const result = calcRisk(entity);
    expect(result.label).toBe("AMAN");
    expect(result.score).toBe(0);
  });
});
