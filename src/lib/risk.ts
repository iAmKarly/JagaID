import { Entity, RiskResult } from "@/types";

export const RISK_WEIGHTS = {
  reportScore: { perReport: 4, max: 60 },
  networkScore: { perConnection: 8, max: 24 },
  recencyScore: { within30Days: 15, within90Days: 8, older: 0 },
} as const;

export function calcRecencyScore(lastSeen: string): number {
  const daysSince = Math.floor(
    (Date.now() - new Date(lastSeen).getTime()) / 86_400_000
  );
  if (daysSince < 0) return RISK_WEIGHTS.recencyScore.older;
  if (daysSince < 30) return RISK_WEIGHTS.recencyScore.within30Days;
  if (daysSince < 90) return RISK_WEIGHTS.recencyScore.within90Days;
  return RISK_WEIGHTS.recencyScore.older;
}

export function calcRiskScore(entity: Entity): {
  score: number;
  breakdown: { reportScore: number; networkScore: number; recencyScore: number };
} {
  const reportScore = Math.min(
    entity.reports * RISK_WEIGHTS.reportScore.perReport,
    RISK_WEIGHTS.reportScore.max
  );
  const networkScore = Math.min(
    (entity.connected ?? []).length * RISK_WEIGHTS.networkScore.perConnection,
    RISK_WEIGHTS.networkScore.max
  );
  const recencyScore = calcRecencyScore(entity.last_seen);
  const score = Math.min(reportScore + networkScore + recencyScore, 100);
  return { score, breakdown: { reportScore, networkScore, recencyScore } };
}

export function getRiskLabel(
  score: number
): RiskResult["label"] {
  if (score >= 80) return "BAHAYA TINGGI";
  if (score >= 50) return "MENCURIGAKAN";
  if (score >= 20) return "WASPADA";
  return "AMAN";
}

export function getRiskColor(label: RiskResult["label"]): string {
  const colors: Record<RiskResult["label"], string> = {
    "BAHAYA TINGGI": "#ff2d2d",
    MENCURIGAKAN: "#ff9500",
    WASPADA: "#ffd60a",
    AMAN: "#30d158",
  };
  return colors[label];
}

export function calcRisk(entity: Entity): RiskResult {
  const { score, breakdown } = calcRiskScore(entity);
  const label = getRiskLabel(score);
  const color = getRiskColor(label);
  return { score, label, color, breakdown };
}
