import {
  normalizeQuery,
  matchesEntity,
  findEntity,
  getEntityReports,
  getEntityNetwork,
  lookup,
} from "@/lib/lookup";
import { Database, Entity } from "@/types";
import { SEED_DB } from "@/lib/seed-data";

// ── normalizeQuery ──────────────────────────────────────────────────────────
describe("normalizeQuery", () => {
  it("trims whitespace", () => {
    expect(normalizeQuery("  1234  ")).toBe("1234");
  });

  it("lowercases", () => {
    expect(normalizeQuery("GOPAY:ABC")).toBe("gopay:abc");
  });

  it("removes internal spaces and hyphens", () => {
    expect(normalizeQuery("1234 5678")).toBe("12345678");
    expect(normalizeQuery("invest-cepat.com")).toBe("investcepat.com");
  });

  it("handles empty string", () => {
    expect(normalizeQuery("")).toBe("");
  });

  // URL-shaped inputs: real users paste full URLs from browsers. The
  // normaliser must strip protocol, www., and path so they still match
  // the shorter stored form.
  it("strips https:// prefix", () => {
    expect(normalizeQuery("https://investasicepat.com")).toBe("investasicepat.com");
  });

  it("strips http:// prefix", () => {
    expect(normalizeQuery("http://investasicepat.com")).toBe("investasicepat.com");
  });

  it("strips leading www.", () => {
    expect(normalizeQuery("www.investasicepat.com")).toBe("investasicepat.com");
  });

  it("strips https://www. together", () => {
    expect(normalizeQuery("https://www.investasi-cepat.com")).toBe("investasicepat.com");
  });

  it("strips path, query, and hash", () => {
    expect(normalizeQuery("https://investasicepat.com/path?ref=foo#hash")).toBe(
      "investasicepat.com"
    );
  });
});

// ── matchesEntity ───────────────────────────────────────────────────────────
describe("matchesEntity", () => {
  const entity: Entity = {
    id: "x",
    type: "bank_account",
    value: "1234567890",
    reports: 1,
    connected: [],
    last_seen: "2024-01-01",
  };

  it("matches exact value", () => {
    expect(matchesEntity(entity, "1234567890")).toBe(true);
  });

  it("matches normalized whitespace", () => {
    expect(matchesEntity(entity, "1234 567890")).toBe(true);
  });

  it("does not match partial substring", () => {
    expect(matchesEntity(entity, "234567")).toBe(false);
  });

  it("does not match short prefix (no wildcard collision)", () => {
    expect(matchesEntity(entity, "123")).toBe(false);
  });

  it("does not treat % as a wildcard", () => {
    expect(matchesEntity(entity, "%")).toBe(false);
  });

  it("does not match unrelated value", () => {
    expect(matchesEntity(entity, "9999999999")).toBe(false);
  });
});

// ── findEntity ──────────────────────────────────────────────────────────────
describe("findEntity", () => {
  it("finds entity by bank account number", () => {
    const result = findEntity("1234567890", SEED_DB);
    expect(result).toBeDefined();
    expect(result?.id).toBe("e1");
  });

  it("finds entity by phone number", () => {
    const result = findEntity("08123456789", SEED_DB);
    expect(result).toBeDefined();
    expect(result?.type).toBe("phone");
  });

  it("finds entity by domain", () => {
    const result = findEntity("investasi-cepat.com", SEED_DB);
    expect(result).toBeDefined();
    expect(result?.id).toBe("e5");
  });

  it("returns undefined for unknown entity", () => {
    expect(findEntity("0000000000", SEED_DB)).toBeUndefined();
  });

  it("returns undefined for empty query", () => {
    expect(findEntity("", SEED_DB)).toBeUndefined();
  });

  it("is case-insensitive", () => {
    const result = findEntity("INVESTASI-CEPAT.COM", SEED_DB);
    expect(result?.id).toBe("e5");
  });
});

// ── getEntityReports ─────────────────────────────────────────────────────────
describe("getEntityReports", () => {
  it("returns all reports for a given entity", () => {
    const reports = getEntityReports("e1", SEED_DB);
    expect(reports.length).toBeGreaterThanOrEqual(2);
    reports.forEach((r) => expect(r.entity_id).toBe("e1"));
  });

  it("returns empty array when no reports exist", () => {
    expect(getEntityReports("nonexistent", SEED_DB)).toHaveLength(0);
  });
});

// ── getEntityNetwork ──────────────────────────────────────────────────────────
describe("getEntityNetwork", () => {
  it("returns connected entities", () => {
    const e1 = SEED_DB.entities.find((e) => e.id === "e1")!;
    const network = getEntityNetwork(e1, SEED_DB);
    expect(network.length).toBe(e1.connected.length);
    network.forEach((n) => expect(e1.connected).toContain(n.id));
  });

  it("returns empty array for entity with no connections", () => {
    const e5 = SEED_DB.entities.find((e) => e.id === "e6")!;
    expect(getEntityNetwork(e5, SEED_DB)).toHaveLength(0);
  });
});

// ── lookup (full pipeline) ───────────────────────────────────────────────────
describe("lookup", () => {
  it("returns found=false for unknown query", () => {
    const result = lookup("0000000000", SEED_DB);
    expect(result.found).toBe(false);
    expect(result.entity).toBeUndefined();
    expect(result.risk).toBeUndefined();
  });

  it("returns found=true with risk and reports for known entity", () => {
    const result = lookup("1234567890", SEED_DB);
    expect(result.found).toBe(true);
    expect(result.entity).toBeDefined();
    expect(result.risk).toBeDefined();
    expect(result.reports).toBeDefined();
    expect(result.network).toBeDefined();
  });

  it("includes network entities in result", () => {
    const result = lookup("1234567890", SEED_DB);
    expect(result.network!.length).toBeGreaterThan(0);
  });

  it("risk score is 0–100", () => {
    const result = lookup("1234567890", SEED_DB);
    expect(result.risk!.score).toBeGreaterThanOrEqual(0);
    expect(result.risk!.score).toBeLessThanOrEqual(100);
  });
});
