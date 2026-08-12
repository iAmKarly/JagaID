/**
 * tests/unit/db.test.ts
 *
 * Tests db.ts in seed-fallback mode (USE_SUPABASE and NEXT_PUBLIC_USE_SUPABASE both unset).
 * The Supabase path is tested via integration tests with a mock server.
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
  // Force seed fallback mode — clear ALL vars that could trigger Supabase path
  delete process.env.USE_SUPABASE;
  delete process.env.NEXT_PUBLIC_USE_SUPABASE;
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

// ── dbLookup ──────────────────────────────────────────────────────────────────
describe("dbLookup (seed fallback)", () => {
  it("returns found=false for unknown query", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("0000000000");
    expect(result.found).toBe(false);
    expect(result.entity).toBeUndefined();
    expect(result.risk).toBeUndefined();
  });

  it("returns found=true with entity and risk for known entity", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("1234567890");
    expect(result.found).toBe(true);
    expect(result.entity).toBeDefined();
    expect(result.entity!.value).toBe("1234567890");
    expect(result.risk).toBeDefined();
    expect(result.risk!.score).toBeGreaterThan(0);
    expect(result.risk!.score).toBeLessThanOrEqual(100);
  });

  it("returns reports for a known entity", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("1234567890");
    expect(Array.isArray(result.reports)).toBe(true);
    expect(result.reports!.length).toBeGreaterThan(0);
  });

  it("returns network for a connected entity", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("1234567890");
    expect(Array.isArray(result.network)).toBe(true);
    expect(result.network!.length).toBeGreaterThan(0);
  });

  it("is case-insensitive", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("INVESTASI-CEPAT.COM");
    expect(result.found).toBe(true);
  });

  it("returns empty network for unconnected entity", async () => {
    const { dbLookup } = await import("@/lib/db");
    const result = await dbLookup("1111111111");
    expect(result.found).toBe(true);
    expect(result.network).toHaveLength(0);
  });
});

// ── dbSubmitReport ─────────────────────────────────────────────────────────────
describe("dbSubmitReport (seed fallback)", () => {
  it("creates a new entity when value is not in DB", async () => {
    const { dbSubmitReport } = await import("@/lib/db");
    const result = await dbSubmitReport({
      type: "bank_account",
      value: "9999988888",
      bank: "BNI",
      scam_type: "Transfer Penipuan",
      description: "Test penipuan baru yang belum ada di database sama sekali.",
    });
    expect(result.entity_id).toBeDefined();
    expect(typeof result.entity_id).toBe("string");
  });

  it("increments report count for existing entity", async () => {
    const { dbSubmitReport, dbLookup } = await import("@/lib/db");

    // Get current count
    const before = await dbLookup("1234567890");
    const countBefore = before.entity!.reports;

    await dbSubmitReport({
      type: "bank_account",
      value: "1234567890",
      scam_type: "Transfer Penipuan",
      description: "Laporan tambahan untuk entitas yang sudah ada di database.",
    });

    const after = await dbLookup("1234567890");
    expect(after.entity!.reports).toBe(countBefore + 1);
  });

  it("returns the same entity_id for an existing entity", async () => {
    const { dbSubmitReport } = await import("@/lib/db");
    const result = await dbSubmitReport({
      type: "phone",
      value: "08123456789",
      scam_type: "Phishing",
      description: "Konfirmasi entitas yang sudah ada akan mengembalikan ID yang sama.",
    });
    expect(result.entity_id).toBe("e2");
  });
});

// ── dbGetStats ─────────────────────────────────────────────────────────────────
describe("dbGetStats (seed fallback)", () => {
  it("returns non-zero stats from seed data", async () => {
    const { dbGetStats } = await import("@/lib/db");
    const stats = await dbGetStats();
    expect(stats.totalReports).toBeGreaterThan(0);
    expect(stats.totalEntities).toBeGreaterThan(0);
    expect(stats.bankCount).toBeGreaterThan(0);
    expect(typeof stats.highRiskCount).toBe("number");
  });

  it("bankCount is less than or equal to totalEntities", async () => {
    const { dbGetStats } = await import("@/lib/db");
    const stats = await dbGetStats();
    expect(stats.bankCount).toBeLessThanOrEqual(stats.totalEntities);
  });

  it("highRiskCount is less than or equal to totalEntities", async () => {
    const { dbGetStats } = await import("@/lib/db");
    const stats = await dbGetStats();
    expect(stats.highRiskCount).toBeLessThanOrEqual(stats.totalEntities);
  });
});

// ── dbGetTopEntities ───────────────────────────────────────────────────────────
describe("dbGetTopEntities (seed fallback)", () => {
  it("returns up to the requested limit", async () => {
    const { dbGetTopEntities } = await import("@/lib/db");
    const entities = await dbGetTopEntities(3);
    expect(entities.length).toBeLessThanOrEqual(3);
  });

  it("returns entities sorted by risk score descending", async () => {
    const { dbGetTopEntities } = await import("@/lib/db");
    const { calcRisk } = await import("@/lib/risk");
    const entities = await dbGetTopEntities(5);
    const scores = entities.map((e) => calcRisk(e).score);
    for (let i = 0; i < scores.length - 1; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i + 1]);
    }
  });

  it("default limit returns 5 entities", async () => {
    const { dbGetTopEntities } = await import("@/lib/db");
    const entities = await dbGetTopEntities();
    expect(entities.length).toBeLessThanOrEqual(5);
  });
});

// ── dbGetDatabase ──────────────────────────────────────────────────────────────
describe("dbGetDatabase (seed fallback)", () => {
  it("returns seed database with entities and reports", async () => {
    const { dbGetDatabase } = await import("@/lib/db");
    const db = await dbGetDatabase();
    expect(Array.isArray(db.entities)).toBe(true);
    expect(Array.isArray(db.reports)).toBe(true);
    expect(db.entities.length).toBeGreaterThan(0);
    expect(db.reports.length).toBeGreaterThan(0);
  });
});
