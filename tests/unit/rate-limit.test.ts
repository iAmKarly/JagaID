import { rateLimit, _resetRateLimitForTests } from "@/lib/rate-limit";

beforeEach(() => {
  _resetRateLimitForTests();
});

describe("rateLimit", () => {
  it("allows the first call in a window", () => {
    const r = rateLimit("user-1", 3, 60_000);
    expect(r.ok).toBe(true);
    expect(r.remaining).toBe(2);
  });

  it("counts down remaining as calls accumulate", () => {
    rateLimit("user-1", 3, 60_000);
    rateLimit("user-1", 3, 60_000);
    const third = rateLimit("user-1", 3, 60_000);
    expect(third.ok).toBe(true);
    expect(third.remaining).toBe(0);
  });

  it("rejects when the cap is hit", () => {
    rateLimit("user-1", 2, 60_000);
    rateLimit("user-1", 2, 60_000);
    const blocked = rateLimit("user-1", 2, 60_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.resetIn).toBeGreaterThan(0);
  });

  it("isolates buckets by key", () => {
    rateLimit("user-A", 1, 60_000);
    rateLimit("user-A", 1, 60_000); // exhaust A
    const userB = rateLimit("user-B", 1, 60_000);
    expect(userB.ok).toBe(true);
  });

  it("resets after the window passes", async () => {
    rateLimit("short-window", 1, 50);
    expect(rateLimit("short-window", 1, 50).ok).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(rateLimit("short-window", 1, 50).ok).toBe(true);
  });

  it("returns positive resetIn while bucket is alive", () => {
    const r = rateLimit("user-X", 5, 10_000);
    expect(r.resetIn).toBeGreaterThan(0);
    expect(r.resetIn).toBeLessThanOrEqual(10);
  });

  it("reports windowSeconds equal to the configured window", () => {
    const r = rateLimit("user-Y", 5, 30_000);
    expect(r.windowSeconds).toBe(30);
  });
});
