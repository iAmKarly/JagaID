import { ReportPayloadSchema, LookupQuerySchema } from "@/lib/validators";

describe("ReportPayloadSchema", () => {
  const valid = {
    type: "bank_account",
    value: "1234567890",
    bank: "BRI",
    scam_type: "Transfer Penipuan",
    amount: "Rp 2.500.000",
    description: "Modus COD palsu, barang tidak dikirim setelah transfer.",
  };

  it("accepts a fully valid payload", () => {
    expect(() => ReportPayloadSchema.parse(valid)).not.toThrow();
  });

  it("accepts payload without optional fields", () => {
    const { bank, amount, ...minimal } = valid;
    expect(() => ReportPayloadSchema.parse(minimal)).not.toThrow();
  });

  it("rejects missing type", () => {
    const { type, ...rest } = valid;
    expect(() => ReportPayloadSchema.parse(rest)).toThrow();
  });

  it("rejects invalid entity type", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, type: "crypto_wallet" })
    ).toThrow();
  });

  it("rejects invalid scam type", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, scam_type: "Modus Baru XYZ" })
    ).toThrow();
  });

  it("rejects value shorter than 5 chars", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, value: "123" })
    ).toThrow();
  });

  it("rejects description shorter than 10 chars", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, description: "Penipuan" })
    ).toThrow();
  });

  it("rejects description longer than 2000 chars", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, description: "a".repeat(2001) })
    ).toThrow();
  });

  it("trims whitespace from value and description", () => {
    const result = ReportPayloadSchema.parse({
      ...valid,
      value: "  1234567890  ",
      description: "  Modus COD palsu, barang tidak dikirim setelah transfer.  ",
    });
    expect(result.value).toBe("1234567890");
    expect(result.description).not.toMatch(/^\s|\s$/);
  });

  it("rejects bank field longer than 50 chars", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, bank: "x".repeat(51) })
    ).toThrow();
  });

  it("rejects amount field longer than 50 chars", () => {
    expect(() =>
      ReportPayloadSchema.parse({ ...valid, amount: "x".repeat(51) })
    ).toThrow();
  });

  it("accepts all valid entity types", () => {
    const types = ["bank_account", "phone", "ewallet", "domain"] as const;
    types.forEach((t) => {
      expect(() => ReportPayloadSchema.parse({ ...valid, type: t })).not.toThrow();
    });
  });

  it("accepts all valid scam types", () => {
    const scamTypes = [
      "Transfer Penipuan",
      "Investasi Bodong",
      "Phishing",
      "COD Palsu",
      "Pinjol Ilegal",
      "Belanja Online",
      "Lowongan Kerja Palsu",
      "Lainnya",
    ] as const;
    scamTypes.forEach((s) => {
      expect(() =>
        ReportPayloadSchema.parse({ ...valid, scam_type: s })
      ).not.toThrow();
    });
  });
});

describe("LookupQuerySchema", () => {
  it("accepts a valid query", () => {
    expect(() => LookupQuerySchema.parse({ q: "1234567890" })).not.toThrow();
  });

  it("rejects query shorter than 5 chars", () => {
    expect(() => LookupQuerySchema.parse({ q: "123" })).toThrow();
  });

  it("rejects query longer than 200 chars", () => {
    expect(() => LookupQuerySchema.parse({ q: "a".repeat(201) })).toThrow();
  });

  it("rejects missing q field", () => {
    expect(() => LookupQuerySchema.parse({})).toThrow();
  });

  it("trims whitespace", () => {
    const result = LookupQuerySchema.parse({ q: "  08123456789  " });
    expect(result.q).toBe("08123456789");
  });

  it("normalizes uppercase, spaces, and dashes", () => {
    const result = LookupQuerySchema.parse({ q: "INVESTASI-Cepat.com" });
    expect(result.q).toBe("investasicepat.com");
  });

  it("collapses internal whitespace and dashes in value", () => {
    const result = ReportPayloadSchema.parse({
      type: "bank_account",
      value: "1234-567 890",
      scam_type: "Transfer Penipuan",
      description: "Penipuan transfer ke rekening ini, korban kehilangan uang.",
    });
    expect(result.value).toBe("1234567890");
  });
});
