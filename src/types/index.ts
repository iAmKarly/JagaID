export type EntityType = "bank_account" | "phone" | "ewallet" | "domain";

export type ScamType =
  | "Transfer Penipuan"
  | "Investasi Bodong"
  | "Phishing"
  | "COD Palsu"
  | "Pinjol Ilegal"
  | "Belanja Online"
  | "Lowongan Kerja Palsu"
  | "Lainnya";

export interface Entity {
  id: string;
  type: EntityType;
  value: string;
  bank?: string;
  reports: number;
  connected: string[];
  last_seen: string;
  created_at?: string;
  source?: string;
  confidence?: number;
}

/**
 * Entity with risk precomputed on the server. Returned from /api/stats
 * (topEntities) and used inside /api/check (network items). Centralising
 * the risk calc on the server keeps the client thin and keeps the SQL view
 * + lib/risk.ts as a single source of truth (enforced by risk-parity test).
 */
export interface EntityWithRisk extends Entity {
  risk: RiskResult;
}

export interface Report {
  id: string;
  entity_id: string;
  type: ScamType;
  amount?: string;
  date: string;
  description: string;
  created_at?: string;
  source?: string;
  confidence?: number;
}

export interface RiskResult {
  score: number;
  label: "BAHAYA TINGGI" | "MENCURIGAKAN" | "WASPADA" | "AMAN";
  color: string;
  breakdown: {
    reportScore: number;
    networkScore: number;
    recencyScore: number;
  };
}

export interface LookupResponse {
  found: boolean;
  entity?: Entity;
  risk?: RiskResult;
  reports?: Report[];
  network?: EntityWithRisk[];
}

export interface ReportPayload {
  type: EntityType;
  value: string;
  bank?: string;
  scam_type: ScamType;
  amount?: string;
  description: string;
}

export interface Database {
  entities: Entity[];
  reports: Report[];
}
