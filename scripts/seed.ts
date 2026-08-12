/**
 * scripts/seed.ts
 * Seeds the Supabase database with initial JagaID data.
 * Run with: npm run db:seed
 * Test DB: npm run db:seed -- --test
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local
 *
 * Safe to run multiple times — uses upsert (insert or ignore on conflict).
 * The report counter on entities is maintained by a DB trigger, so we insert
 * entities first (with reports=0), then insert the report rows.
 */

import { loadSupabaseScriptEnv } from "./env";

const loadedEnv = loadSupabaseScriptEnv("seed");

// ── Env validation ─────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("");
  console.error("  [seed] ✗ Missing environment variables.");
  console.error(`  Make sure ${loadedEnv.envFile} exists and contains:`);
  console.error("    NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co");
  console.error("    SUPABASE_SERVICE_ROLE_KEY=your-service-role-key");
  console.error("");
  process.exit(1);
}

// ── Seed data (inline — no @/ alias needed in scripts) ────────────────────
// Entities: report count starts at 0 — the DB trigger increments it
// automatically when we insert the corresponding rows into the reports table.
const TODAY = new Date();
const daysAgo = (n: number) =>
  new Date(TODAY.getTime() - n * 86_400_000).toISOString().split("T")[0];

const ENTITIES = [
  { id: "e1", type: "bank_account", value: "1234567890",        bank: "BRI",     reports: 0, last_seen: daysAgo(5)   },
  { id: "e2", type: "phone",        value: "08123456789",        bank: null,      reports: 0, last_seen: daysAgo(10)  },
  { id: "e3", type: "ewallet",      value: "gopay:08123456789",  bank: null,      reports: 0, last_seen: daysAgo(45)  },
  { id: "e4", type: "bank_account", value: "9876543210",         bank: "BCA",     reports: 0, last_seen: daysAgo(100) },
  { id: "e5", type: "domain",       value: "investasicepat.com", bank: null,      reports: 0, last_seen: daysAgo(2)   },
  { id: "e6", type: "bank_account", value: "1111111111",         bank: "Mandiri", reports: 0, last_seen: daysAgo(200) },
];

// Connections: graph edges between entities
const CONNECTIONS = [
  { from_id: "e1", to_id: "e2" },
  { from_id: "e1", to_id: "e3" },
  { from_id: "e2", to_id: "e4" },
];

// Reports: inserting these rows triggers the DB counter on entities
const REPORTS = [
  { id: "r1", entity_id: "e1", type: "Transfer Penipuan", amount: "Rp 2.500.000",  date: "2024-12-01", description: "Modus COD palsu, barang tidak dikirim setelah transfer." },
  { id: "r2", entity_id: "e1", type: "Investasi Bodong",  amount: "Rp 15.000.000", date: "2024-11-25", description: "Iming-iming profit 30% per bulan lalu kabur setelah kumpulkan dana." },
  { id: "r3", entity_id: "e1", type: "Transfer Penipuan", amount: "Rp 500.000",    date: "2024-11-20", description: "Penjual online tidak mengirim barang setelah pembayaran diterima." },
  { id: "r4", entity_id: "e2", type: "Phishing",          amount: "Rp 5.000.000",  date: "2024-11-28", description: "SMS mengaku dari bank meminta kode OTP untuk verifikasi akun." },
  { id: "r5", entity_id: "e2", type: "Phishing",          amount: "Rp 2.000.000",  date: "2024-11-15", description: "WhatsApp mengaku CS bank, meminta data kartu dan OTP." },
  { id: "r6", entity_id: "e3", type: "Transfer Penipuan", amount: "Rp 1.200.000",  date: "2024-10-30", description: "Dompet digital digunakan untuk terima pembayaran jual beli fiktif." },
  { id: "r7", entity_id: "e4", type: "Investasi Bodong",  amount: "Rp 8.000.000",  date: "2024-09-10", description: "Rekening dipakai untuk tampung dana investasi bodong berbunga tinggi." },
  { id: "r8", entity_id: "e5", type: "Investasi Bodong",  amount: "Rp 50.000.000", date: "2024-12-05", description: "Website menawarkan investasi saham dengan return 20% per bulan, tidak ada izin OJK." },
  { id: "r9", entity_id: "e5", type: "Phishing",          amount: "Rp 3.000.000",  date: "2024-11-30", description: "Situs meniru tampilan bank resmi, mencuri kredensial login." },
];

// ── Supabase REST helper ───────────────────────────────────────────────────
type UpsertMode = "merge-duplicates" | "ignore-duplicates";

async function upsert(
  table: string,
  rows: Record<string, unknown>[],
  mode: UpsertMode = "ignore-duplicates"
): Promise<void> {
  if (rows.length === 0) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": `resolution=${mode},return=minimal`,
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[seed] ${table} upsert failed (HTTP ${res.status}): ${body}`);
  }
}

// ── Verify connection ──────────────────────────────────────────────────────
async function verifyConnection(): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/entities?limit=1`, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[seed] Cannot reach Supabase (HTTP ${res.status}): ${body}`);
  }
}

// ── Reset report counters after seed ─────────────────────────────────────
// The trigger increments reports on each insert, but if rows already existed
// (re-seed), the trigger won't fire again. We recalculate from the reports
// table to keep counts accurate.
async function recalcReportCounts(): Promise<void> {
  // Use Supabase RPC if you have a function, or just run a raw SQL via the
  // management API. For simplicity we patch each entity individually.
  const countMap: Record<string, number> = {};
  for (const r of REPORTS) {
    countMap[r.entity_id] = (countMap[r.entity_id] ?? 0) + 1;
  }

  for (const [entityId, count] of Object.entries(countMap)) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/entities?id=eq.${entityId}`,
      {
        method: "PATCH",
        headers: {
          apikey: SUPABASE_KEY!,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({ reports: count }),
      }
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`[seed] Failed to patch report count for ${entityId}: ${body}`);
    }
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(52));
  console.log("  JagaID — Database Seeder");
  console.log("=".repeat(52));
  console.log(`  Env    : ${loadedEnv.envFile}`);
  console.log(`  Target : ${SUPABASE_URL}`);
  console.log(`  Entities: ${ENTITIES.length}`);
  console.log(`  Connections: ${CONNECTIONS.length}`);
  console.log(`  Reports : ${REPORTS.length}`);
  console.log("");

  // 1. Verify we can reach the DB before doing anything
  process.stdout.write("[seed] Verifying connection... ");
  await verifyConnection();
  console.log("✓");

  // 2. Insert entities first (reports=0; trigger will increment)
  process.stdout.write(`[seed] Upserting ${ENTITIES.length} entities... `);
  await upsert("entities", ENTITIES as Record<string, unknown>[]);
  console.log("✓");

  // 3. Insert connections (graph edges)
  process.stdout.write(`[seed] Upserting ${CONNECTIONS.length} connections... `);
  await upsert("connections", CONNECTIONS as Record<string, unknown>[]);
  console.log("✓");

  // 4. Insert reports — trigger increments entity.reports per insert.
  //    Use ignore-duplicates so re-runs don't double-count.
  process.stdout.write(`[seed] Upserting ${REPORTS.length} reports... `);
  await upsert("reports", REPORTS as Record<string, unknown>[]);
  console.log("✓");

  // 5. Patch report counts to match actual data (idempotent re-seed safety)
  process.stdout.write("[seed] Recalculating report counts... ");
  await recalcReportCounts();
  console.log("✓");

  console.log("");
  console.log("  ✅  Seed complete!");
  console.log("=".repeat(52));
}

main().catch((err: unknown) => {
  console.error("");
  console.error("[seed] ✗ Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
