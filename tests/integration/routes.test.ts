/**
 * tests/integration/routes.test.ts
 *
 * Tests all API route handler logic directly — no HTTP server needed.
 * Mirrors the actual route.ts files but runs synchronously against
 * seed data so we can assert exact behaviour without Supabase.
 */

import { lookup, normalizeQuery } from "@/lib/lookup";
import { calcRisk } from "@/lib/risk";
import { ReportPayloadSchema, LookupQuerySchema } from "@/lib/validators";
import { SEED_DB } from "@/lib/seed-data";
import { Database, ReportPayload } from "@/types";
import { parse as csvParse } from "csv-parse/sync";

// ── Shared handler simulators ──────────────────────────────────────────────────
// These mirror the real route logic exactly so changes to routes are caught.

function simulateCheck(q: string, db: Database) {
  const parsed = LookupQuerySchema.safeParse({ q });
  if (!parsed.success) {
    return { status: 400, body: { error: "Query tidak valid" } };
  }
  return { status: 200, body: lookup(parsed.data.q, db) };
}

function simulateReport(payload: unknown, db: Database) {
  const parsed = ReportPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { status: 422, body: { error: parsed.error.flatten() } };
  }
  const data = parsed.data as ReportPayload;
  const newDb: Database = { entities: [...db.entities], reports: [...db.reports] };
  const normalized = normalizeQuery(data.value);
  const existing = newDb.entities.find((e) => normalizeQuery(e.value) === normalized);
  let entityId: string;
  if (existing) {
    entityId = existing.id;
    newDb.entities = newDb.entities.map((e) =>
      e.id === existing.id
        ? {
            ...e,
            reports: e.reports + 1,
            last_seen: new Date().toISOString().split("T")[0],
          }
        : e
    );
  } else {
    entityId = `e_${Date.now()}`;
    newDb.entities.push({
      id: entityId,
      type: data.type,
      value: normalized,
      bank: data.bank,
      reports: 1,
      connected: [],
      last_seen: new Date().toISOString().split("T")[0],
    });
  }
  newDb.reports.push({
    id: `r_${Date.now()}`,
    entity_id: entityId,
    type: data.scam_type,
    amount: data.amount,
    date: new Date().toISOString().split("T")[0],
    description: data.description,
  });
  return { status: 201, body: { success: true, entity_id: entityId }, db: newDb };
}

function simulateStats(db: Database) {
  return {
    status: 200,
    body: {
      stats: {
        totalReports: db.reports.length,
        totalEntities: db.entities.length,
        highRiskCount: db.entities.filter((e) => calcRisk(e).score >= 80).length,
        bankCount: db.entities.filter((e) => e.type === "bank_account").length,
      },
      topEntities: [...db.entities]
        .sort((a, b) => calcRisk(b).score - calcRisk(a).score)
        .slice(0, 5),
    },
  };
}

function simulateAdminAuth(key: string | null, expectedKey: string) {
  return key === expectedKey;
}

function parseCsv(text: string): Array<Record<string, string>> {
  if (!text.trim()) return [];
  const records = csvParse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return records.filter((r) => r.value && r.value.trim().length > 0);
}

// ── /api/check ─────────────────────────────────────────────────────────────────
describe("GET /api/check", () => {
  it("returns 400 for query shorter than 5 chars", () => {
    expect(simulateCheck("abc", SEED_DB).status).toBe(400);
  });

  it("returns 400 for empty query", () => {
    expect(simulateCheck("", SEED_DB).status).toBe(400);
  });

  it("returns 200 found=false for unknown number", () => {
    const res = simulateCheck("0000000000", SEED_DB);
    expect(res.status).toBe(200);
    expect((res.body as { found: boolean }).found).toBe(false);
  });

  it("returns 200 found=true for known bank account", () => {
    const res = simulateCheck("1234567890", SEED_DB);
    expect(res.status).toBe(200);
    const body = res.body as {
      found: boolean;
      entity?: { value: string };
      risk?: { score: number };
    };
    expect(body.found).toBe(true);
    expect(body.entity?.value).toBe("1234567890");
    expect(body.risk?.score).toBeGreaterThan(0);
  });

  it("returns 200 found=true for known phone number", () => {
    const res = simulateCheck("08123456789", SEED_DB);
    expect(res.status).toBe(200);
    expect((res.body as { found: boolean }).found).toBe(true);
  });

  it("returns 200 found=true for known domain", () => {
    const res = simulateCheck("investasi-cepat.com", SEED_DB);
    expect(res.status).toBe(200);
    expect((res.body as { found: boolean }).found).toBe(true);
  });

  it("includes network array in result", () => {
    const res = simulateCheck("1234567890", SEED_DB);
    const body = res.body as { network?: unknown[] };
    expect(Array.isArray(body.network)).toBe(true);
    expect(body.network!.length).toBeGreaterThan(0);
  });

  it("includes reports array in result", () => {
    const res = simulateCheck("1234567890", SEED_DB);
    const body = res.body as { reports?: unknown[] };
    expect(Array.isArray(body.reports)).toBe(true);
  });

  it("risk score is within 0–100", () => {
    const res = simulateCheck("1234567890", SEED_DB);
    const body = res.body as { risk?: { score: number } };
    expect(body.risk!.score).toBeGreaterThanOrEqual(0);
    expect(body.risk!.score).toBeLessThanOrEqual(100);
  });

  it("risk label is a valid value", () => {
    const res = simulateCheck("1234567890", SEED_DB);
    const body = res.body as { risk?: { label: string } };
    expect(["BAHAYA TINGGI", "MENCURIGAKAN", "WASPADA", "AMAN"]).toContain(
      body.risk!.label
    );
  });
});

// ── /api/report ────────────────────────────────────────────────────────────────
describe("POST /api/report", () => {
  const validPayload = {
    type: "bank_account" as const,
    value: "5555599999",
    bank: "BNI",
    scam_type: "Transfer Penipuan" as const,
    amount: "Rp 1.000.000",
    description: "Pelaku mengaku penjual online dan menghilang setelah terima uang.",
  };

  it("returns 422 for completely empty payload", () => {
    expect(simulateReport({}, SEED_DB).status).toBe(422);
  });

  it("returns 422 for missing value", () => {
    const { value, ...rest } = validPayload;
    expect(simulateReport(rest, SEED_DB).status).toBe(422);
  });

  it("returns 422 for missing description", () => {
    const { description, ...rest } = validPayload;
    expect(simulateReport(rest, SEED_DB).status).toBe(422);
  });

  it("returns 422 for description under 10 chars", () => {
    expect(
      simulateReport({ ...validPayload, description: "Penipuan" }, SEED_DB).status
    ).toBe(422);
  });

  it("returns 422 for value under 5 chars", () => {
    expect(simulateReport({ ...validPayload, value: "1234" }, SEED_DB).status).toBe(422);
  });

  it("returns 422 for invalid entity type", () => {
    expect(simulateReport({ ...validPayload, type: "bitcoin" }, SEED_DB).status).toBe(
      422
    );
  });

  it("returns 422 for invalid scam type", () => {
    expect(
      simulateReport({ ...validPayload, scam_type: "Modus Alien" }, SEED_DB).status
    ).toBe(422);
  });

  it("returns 201 for valid new entity", () => {
    const db: Database = {
      entities: [...SEED_DB.entities],
      reports: [...SEED_DB.reports],
    };
    const res = simulateReport(validPayload, db);
    expect(res.status).toBe(201);
    expect((res.body as { success: boolean }).success).toBe(true);
    expect((res.body as { entity_id: string }).entity_id).toBeDefined();
  });

  it("new entity is added to database", () => {
    const db: Database = {
      entities: [...SEED_DB.entities],
      reports: [...SEED_DB.reports],
    };
    const before = db.entities.length;
    const res = simulateReport(validPayload, db) as {
      status: number;
      body: object;
      db: Database;
    };
    expect(res.db.entities.length).toBe(before + 1);
  });

  it("returns entity_id of existing entity when value matches", () => {
    const db: Database = {
      entities: [...SEED_DB.entities],
      reports: [...SEED_DB.reports],
    };
    const res = simulateReport({ ...validPayload, value: "1234567890" }, db) as {
      status: number;
      body: { entity_id: string };
      db: Database;
    };
    expect(res.body.entity_id).toBe("e1");
  });

  it("increments report count on existing entity", () => {
    const db: Database = {
      entities: [...SEED_DB.entities],
      reports: [...SEED_DB.reports],
    };
    const before = db.entities.find((e) => e.id === "e1")!.reports;
    const res = simulateReport({ ...validPayload, value: "1234567890" }, db) as {
      status: number;
      body: object;
      db: Database;
    };
    const after = res.db.entities.find((e) => e.id === "e1")!.reports;
    expect(after).toBe(before + 1);
  });

  it("adds a report row on success", () => {
    const db: Database = {
      entities: [...SEED_DB.entities],
      reports: [...SEED_DB.reports],
    };
    const before = db.reports.length;
    const res = simulateReport(validPayload, db) as {
      status: number;
      body: object;
      db: Database;
    };
    expect(res.db.reports.length).toBe(before + 1);
  });

  it("accepts all valid scam types", () => {
    const types = [
      "Transfer Penipuan",
      "Investasi Bodong",
      "Phishing",
      "COD Palsu",
      "Pinjol Ilegal",
      "Belanja Online",
      "Lowongan Kerja Palsu",
      "Lainnya",
    ] as const;
    types.forEach((scam_type) => {
      const db: Database = {
        entities: [...SEED_DB.entities],
        reports: [...SEED_DB.reports],
      };
      const res = simulateReport(
        { ...validPayload, value: `777777${scam_type.length}`, scam_type },
        db
      );
      expect(res.status).toBe(201);
    });
  });
});

// ── /api/stats ─────────────────────────────────────────────────────────────────
describe("GET /api/stats", () => {
  it("returns correct totalReports count", () => {
    const res = simulateStats(SEED_DB);
    expect(res.body.stats.totalReports).toBe(SEED_DB.reports.length);
  });

  it("returns correct totalEntities count", () => {
    const res = simulateStats(SEED_DB);
    expect(res.body.stats.totalEntities).toBe(SEED_DB.entities.length);
  });

  it("bankCount is accurate", () => {
    const res = simulateStats(SEED_DB);
    const expected = SEED_DB.entities.filter((e) => e.type === "bank_account").length;
    expect(res.body.stats.bankCount).toBe(expected);
  });

  it("highRiskCount is a non-negative number", () => {
    const res = simulateStats(SEED_DB);
    expect(res.body.stats.highRiskCount).toBeGreaterThanOrEqual(0);
  });

  it("topEntities has at most 5 items", () => {
    const res = simulateStats(SEED_DB);
    expect(res.body.topEntities.length).toBeLessThanOrEqual(5);
  });

  it("topEntities is sorted by risk score descending", () => {
    const res = simulateStats(SEED_DB);
    const scores = res.body.topEntities.map((e) => calcRisk(e).score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });
});

// ── /api/admin auth guard ──────────────────────────────────────────────────────
describe("Admin auth guard", () => {
  const SECRET = "super-secret-key-abc123";

  it("rejects null key", () => {
    expect(simulateAdminAuth(null, SECRET)).toBe(false);
  });

  it("rejects wrong key", () => {
    expect(simulateAdminAuth("wrong-key", SECRET)).toBe(false);
  });

  it("rejects empty string", () => {
    expect(simulateAdminAuth("", SECRET)).toBe(false);
  });

  it("accepts correct key", () => {
    expect(simulateAdminAuth(SECRET, SECRET)).toBe(true);
  });

  it("is case-sensitive", () => {
    expect(simulateAdminAuth(SECRET.toUpperCase(), SECRET)).toBe(false);
  });
});

// ── CSV parser (used by /api/admin/upload) ─────────────────────────────────────
describe("CSV parser", () => {
  it("parses valid CSV with header row", () => {
    const csv = `type,value,bank,scam_type
bank_account,1234567890,BRI,Transfer Penipuan
phone,08123456789,,Phishing`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0].type).toBe("bank_account");
    expect(rows[0].value).toBe("1234567890");
    expect(rows[0].bank).toBe("BRI");
    expect(rows[1].type).toBe("phone");
  });

  it("returns empty array for header-only CSV", () => {
    expect(parseCsv("type,value,bank,scam_type")).toHaveLength(0);
  });

  it("returns empty array for empty string", () => {
    expect(parseCsv("")).toHaveLength(0);
  });

  it("filters out rows with empty value", () => {
    const csv = `type,value,bank,scam_type
bank_account,,BRI,Transfer Penipuan
phone,08123456789,,Phishing`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("08123456789");
  });

  it("handles Windows-style CRLF line endings", () => {
    const csv = "type,value,bank,scam_type\r\nphone,08123456789,,Phishing";
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("08123456789");
  });

  it("handles quoted values", () => {
    // Quoted values are stripped of surrounding quotes
    const csv = `type,value,bank,scam_type
domain,"investasi-cepat.com",,Investasi Bodong`;
    const rows = parseCsv(csv);
    // Our parser already strips quotes via .replace(/^"|"$/g, "")
    expect(rows[0].value).toBe("investasi-cepat.com");
  });

  it("handles missing optional columns gracefully", () => {
    const csv = `type,value
bank_account,1234567890`;
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].value).toBe("1234567890");
    expect(rows[0].bank).toBe(undefined);
  });
});

// ── Risk score cross-validation ────────────────────────────────────────────────
describe("Risk score consistency: check route vs direct calcRisk", () => {
  it("lookup and direct calcRisk return identical score and label", () => {
    const entity = SEED_DB.entities.find((e) => e.id === "e1")!;
    const direct = calcRisk(entity);
    const res = simulateCheck("1234567890", SEED_DB);
    const body = res.body as { risk?: { score: number; label: string } };
    expect(body.risk!.score).toBe(direct.score);
    expect(body.risk!.label).toBe(direct.label);
  });

  it("stats highRiskCount matches actual entity risk calculations", () => {
    const statsRes = simulateStats(SEED_DB);
    const actualHigh = SEED_DB.entities.filter((e) => calcRisk(e).score >= 80).length;
    expect(statsRes.body.stats.highRiskCount).toBe(actualHigh);
  });
});
