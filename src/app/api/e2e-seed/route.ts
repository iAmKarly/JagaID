/**
 * GET /api/e2e-seed
 *
 * Inserts a small, known set of test fixtures so e2e tests have
 * predictable data to work with — regardless of whether the app
 * is running in seed-fallback mode or against a real Supabase.
 *
 * Only enabled when E2E_SEED_KEY is set in environment.
 * Never call this from production without the key.
 *
 * Called automatically by tests/e2e/global-setup.ts before the
 * Playwright suite runs.
 *
 * Guarantees:
 *   - "1234567890" exists, score = 99 (BAHAYA TINGGI), has 3 network connections
 *   - "0000000000" does NOT exist (returns not found)
 *   - "08123456789" exists
 */

import { NextRequest, NextResponse } from "next/server";
import { SEED_DB } from "@/lib/seed-data";
import { isAuthorizedHeader } from "@/lib/auth";

function isAuthorized(req: NextRequest): boolean {
  return isAuthorizedHeader(req, "x-e2e-key", "E2E_SEED_KEY");
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const USE_SUPABASE = process.env.USE_SUPABASE === "true" || process.env.NEXT_PUBLIC_USE_SUPABASE === "true";

  if (!USE_SUPABASE) {
    // Seed-fallback mode — SEED_DB is already populated and correct, nothing to do
    return NextResponse.json({
      ok: true,
      mode: "seed-fallback",
      entities: SEED_DB.entities.length,
      reports: SEED_DB.reports.length,
    });
  }

  const { supabaseAdmin } = await import("@/lib/supabase");
  const db = supabaseAdmin();

  const today = new Date().toISOString().split("T")[0];
  const daysAgo = (n: number) =>
    new Date(Date.now() - n * 86_400_000).toISOString().split("T")[0];

  // ── Entities ────────────────────────────────────────────────────────────────
  // e2e_1: "1234567890" — must score >= 80 (BAHAYA TINGGI)
  //   reportScore  = min(15 × 4, 60) = 60
  //   networkScore = min(3 × 8, 24)  = 24
  //   recencyScore = 15 (within 30 days)
  //   total = 99 → BAHAYA TINGGI ✓
  const testEntities = [
    { id: "e2e_1", type: "bank_account", value: "1234567890",   bank: "BRI",  reports: 0, last_seen: daysAgo(5)  },
    { id: "e2e_5", type: "bank_account", value: "e2elinkedacct", bank: "BNI", reports: 0, last_seen: daysAgo(3) },
    { id: "e2e_2", type: "phone",        value: "08123456789",  bank: null,   reports: 0, last_seen: daysAgo(10) },
    { id: "e2e_3", type: "ewallet",      value: "gopay:081234", bank: null,   reports: 0, last_seen: daysAgo(20) },
    { id: "e2e_4", type: "domain",       value: "investasicepat.com", bank: null, reports: 0, last_seen: daysAgo(2) },
  ];

  // ── Connections (gives e2e_1 a network of 3 → networkScore = 24) ────────────
  const testConnections = [
    { from_id: "e2e_1", to_id: "e2e_2" },
    { from_id: "e2e_1", to_id: "e2e_3" },
    { from_id: "e2e_1", to_id: "e2e_5" },
  ];

  // ── Reports (15 for e2e_1 → reportScore = 60, total score = 99) ─────────────
  const reportsForE2e1 = Array.from({ length: 15 }, (_, i) => ({
    id: `e2e_r1_${i}`,
    entity_id: "e2e_1",
    type: i % 3 === 0 ? "Investasi Bodong" : i % 3 === 1 ? "Transfer Penipuan" : "Phishing",
    amount: `Rp ${(i + 1) * 500_000}`,
    date: daysAgo(i),
    description: `E2E test report ${i + 1}: laporan penipuan untuk memastikan skor risiko tinggi.`,
  }));

  const reportsForOthers = [
    { id: "e2e_r2_0", entity_id: "e2e_2", type: "Phishing",         amount: "Rp 1.000.000", date: today, description: "E2E test: SMS mengaku dari bank meminta kode OTP untuk verifikasi akun." },
    { id: "e2e_r4_0", entity_id: "e2e_4", type: "Investasi Bodong", amount: "Rp 5.000.000", date: today, description: "E2E test: website investasi ilegal tanpa izin OJK menawarkan return tinggi." },
  ];

  const allReports = [...reportsForE2e1, ...reportsForOthers];

  try {
    // First delete any existing e2e data to start clean
    const e2eIds = testEntities.map(e => e.id);
    await db.from("reports").delete().like("id", "e2e_%");
    await db.from("connections").delete().in("from_id", e2eIds);
    await db.from("entities").delete().in("id", e2eIds);
    await db.from("entities").delete().eq("type", "bank_account").like("value", "99887766%");

    // Insert fresh
    const { error: eErr } = await db.from("entities").insert(testEntities);
    if (eErr) throw new Error(`entities: ${eErr.message}`);

    const { error: cErr } = await db.from("connections").insert(testConnections);
    if (cErr) throw new Error(`connections: ${cErr.message}`);

    const { error: rErr } = await db.from("reports").insert(allReports);
    if (rErr) throw new Error(`reports: ${rErr.message}`);

    // Patch report counts to exact values (trigger may have incremented, this corrects it)
    const countMap: Record<string, number> = {};
    allReports.forEach((r) => { countMap[r.entity_id] = (countMap[r.entity_id] ?? 0) + 1; });
    for (const [id, count] of Object.entries(countMap)) {
      await db.from("entities").update({ reports: count }).eq("id", id);
    }

    return NextResponse.json({
      ok: true,
      mode: "supabase",
      inserted: {
        entities: testEntities.length,
        connections: testConnections.length,
        reports: allReports.length,
      },
      expected_score: { "1234567890": "99 (BAHAYA TINGGI)" },
    });
  } catch (err) {
    console.error("[/api/e2e-seed]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE — clean up e2e test data after suite runs
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const USE_SUPABASE = process.env.USE_SUPABASE === "true" || process.env.NEXT_PUBLIC_USE_SUPABASE === "true";
  if (!USE_SUPABASE) {
    return NextResponse.json({ ok: true, mode: "seed-fallback", note: "Nothing to clean up" });
  }

  const { supabaseAdmin } = await import("@/lib/supabase");
  const db = supabaseAdmin();

  const e2eIds = ["e2e_1", "e2e_2", "e2e_3", "e2e_4", "e2e_5"];
  await db.from("reports").delete().like("id", "e2e_%");
  await db.from("connections").delete().in("from_id", e2eIds);
  await db.from("entities").delete().in("id", e2eIds);
  await db.from("entities").delete().eq("type", "bank_account").like("value", "99887766%");

  return NextResponse.json({ ok: true, mode: "supabase", cleaned: e2eIds });
}
