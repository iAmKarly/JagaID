/**
 * tests/unit/supabase.test.ts
 * Tests the lazy Supabase client factory functions.
 * We never actually connect — we only test that the factories
 * validate env vars correctly and return a client when vars are set.
 */

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  jest.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  process.env = ORIGINAL_ENV;
});

describe("supabase() — browser client", () => {
  it("throws when NEXT_PUBLIC_SUPABASE_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { supabase } = await import("@/lib/supabase");
    expect(() => supabase()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("throws when NEXT_PUBLIC_SUPABASE_ANON_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { supabase } = await import("@/lib/supabase");
    expect(() => supabase()).toThrow(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });

  it("throws when both vars are missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const { supabase } = await import("@/lib/supabase");
    expect(() => supabase()).toThrow();
  });

  it("returns a client object when both vars are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key";
    const { supabase } = await import("@/lib/supabase");
    const client = supabase();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });

  it("does not throw at import time — only when called", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    // Import must not throw
    expect(async () => {
      await import("@/lib/supabase");
    }).not.toThrow();
  });
});

describe("supabaseAdmin() — server client", () => {
  it("throws when SUPABASE_SERVICE_ROLE_KEY is missing", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const { supabaseAdmin } = await import("@/lib/supabase");
    expect(() => supabaseAdmin()).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("throws when URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    const { supabaseAdmin } = await import("@/lib/supabase");
    expect(() => supabaseAdmin()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });

  it("returns an admin client when all vars are present", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-key";
    const { supabaseAdmin } = await import("@/lib/supabase");
    const client = supabaseAdmin();
    expect(client).toBeDefined();
    expect(typeof client.from).toBe("function");
  });
});
