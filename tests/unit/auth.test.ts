import { safeEqual } from "@/lib/auth";

describe("safeEqual", () => {
  it("returns true for matching strings", () => {
    expect(safeEqual("abc123", "abc123")).toBe(true);
  });

  it("returns false for differing strings of equal length", () => {
    expect(safeEqual("abc123", "xyz123")).toBe(false);
  });

  it("returns false for differing lengths", () => {
    expect(safeEqual("abc", "abcdef")).toBe(false);
  });

  it("returns false for null first argument", () => {
    expect(safeEqual(null, "secret")).toBe(false);
  });

  it("returns false for undefined first argument", () => {
    expect(safeEqual(undefined, "secret")).toBe(false);
  });

  it("returns false when expected is undefined (env var missing)", () => {
    expect(safeEqual("anything", undefined)).toBe(false);
  });

  it("returns false for empty string vs anything", () => {
    expect(safeEqual("", "secret")).toBe(false);
  });

  it("is case-sensitive", () => {
    expect(safeEqual("Secret", "secret")).toBe(false);
  });
});
