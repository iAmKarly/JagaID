/**
 * scripts/import-ojk.ts
 *
 * Reads data/ojk-scraped.json (output of scrape-ojk.ts) and pushes
 * the entities into Supabase with deduplication and progress reporting.
 *
 * Run with:
 *   npm run import:ojk
 *   npm run import:ojk -- --test   # import into .env.test Supabase project
 *
 * Full pipeline:
 *   npm run reset:db      ← wipe seed data (with confirmation)
 *   npm run scrape:ojk    ← scrape OJK → data/ojk-scraped.json
 *   npm run import:ojk    ← push scraped data → Supabase
 */

import * as path from "path";
import * as fs from "fs";
import { parse } from "csv-parse/sync";
import type { ScrapedEntity } from "./scrape-ojk";
import { loadSupabaseScriptEnv } from "./env";

const loadedEnv = loadSupabaseScriptEnv("import");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    `\n  [import] ✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${loadedEnv.envFile}\n`
  );
  process.exit(1);
}

// ── Config ────────────────────────────────────────────────────────────────────
const BATCH_SIZE = 50; // Supabase REST handles ~50 rows per request cleanly

// ── Supabase helpers ──────────────────────────────────────────────────────────
async function supabaseUpsert(
  table: string,
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[import] ${table} upsert failed (HTTP ${res.status}): ${body}`);
  }
}

async function countRows(table: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });
  const count = res.headers.get("content-range")?.split("/")?.[1];
  return parseInt(count ?? "0", 10);
}

// ── Transform scraped → DB row ─────────────────────────────────────────────
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}

function detectType(value: string): ScrapedEntity["type"] {
  if (/^https?:\/\/|^www\.|\.com|\.id|\.net|\.org/i.test(value)) return "domain";
  if (/^08|^\+62|^628/.test(value)) return "phone";
  if (/gopay|ovo|dana|shopeepay/i.test(value)) return "ewallet";
  return "bank_account";
}

function parseType(raw: string | undefined, value: string): ScrapedEntity["type"] {
  if (
    raw === "bank_account" ||
    raw === "phone" ||
    raw === "ewallet" ||
    raw === "domain"
  ) {
    return raw;
  }
  return detectType(value);
}

function normalizeImportedValue(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]
    .replace(/[\s\-]/g, "");
}

/** Collapse the verbose source string from the scraper into a stable short tag
 *  the DB can index. Anything unrecognised falls through as "scrape" so we
 *  don't accidentally tag low-confidence rows as "community" or "admin". */
function shortSource(source: string): string {
  const s = source.toLowerCase();
  if (s.includes("alert")) return "ojk-alert";
  if (s.includes("swi")) return "ojk-swi";
  if (s.includes("patrolisiber")) return "patrolisiber";
  if (s.includes("manual")) return "manual-csv";
  return "scrape";
}

function toEntityRow(e: ScrapedEntity): Record<string, unknown> {
  return {
    id: `ojk_${e.type}_${slugify(e.value)}`,
    type: e.type,
    value: normalizeImportedValue(e.value),
    bank: e.bank ?? null,
    reports: 0, // will be incremented by trigger when reports are inserted
    last_seen: new Date().toISOString().split("T")[0],
    created_at: new Date().toISOString(),
    source: shortSource(e.source),
    confidence: e.confidence ?? 30, // default to low if scraper didn't tag it
  };
}

function toReportRow(entityId: string, e: ScrapedEntity): Record<string, unknown> {
  return {
    id: `ojk_report_${entityId}_${slugify(e.scam_type ?? "lainnya")}`,
    entity_id: entityId,
    type: mapScamType(e.scam_type),
    amount: null,
    date: new Date().toISOString().split("T")[0],
    description: `Dilaporkan oleh ${e.source}. Data publik dari OJK/otoritas terkait.`,
    created_at: new Date().toISOString(),
    source: shortSource(e.source),
    confidence: e.confidence ?? 30,
  };
}

const VALID_SCAM_TYPES = new Set([
  "Transfer Penipuan",
  "Investasi Bodong",
  "Phishing",
  "COD Palsu",
  "Pinjol Ilegal",
  "Belanja Online",
  "Lowongan Kerja Palsu",
  "Lainnya",
]);

function mapScamType(raw: string): string {
  if (VALID_SCAM_TYPES.has(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.includes("investasi")) return "Investasi Bodong";
  if (lower.includes("phish") || lower.includes("siber")) return "Phishing";
  if (lower.includes("pinjol") || lower.includes("pinjaman")) return "Pinjol Ilegal";
  if (lower.includes("transfer")) return "Transfer Penipuan";
  return "Lainnya";
}

function loadManualCsv(dataDir: string): ScrapedEntity[] {
  const manualPath = path.join(dataDir, "manual.csv");
  if (!fs.existsSync(manualPath)) return [];

  const rows = parse(fs.readFileSync(manualPath, "utf8"), {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Array<Partial<Record<"type" | "value" | "bank" | "scam_type", string>>>;

  return rows
    .map((row, i): ScrapedEntity | null => {
      const value = row.value?.trim();
      if (!value) return null;

      return {
        type: parseType(row.type, value),
        value,
        bank: row.bank?.trim() || undefined,
        scam_type: row.scam_type?.trim() || "Lainnya",
        source: `Manual CSV (row ${i + 2})`,
        confidence: 90,
        scraped_at: new Date().toISOString(),
      };
    })
    .filter((row): row is ScrapedEntity => row !== null);
}

// ── Batch processor ───────────────────────────────────────────────────────────
async function insertBatched(
  table: string,
  rows: Record<string, unknown>[],
  label: string
): Promise<void> {
  const total = rows.length;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await supabaseUpsert(table, batch);
    inserted += batch.length;
    process.stdout.write(`\r  [import] ${label}: ${inserted}/${total}`);
  }
  console.log(`  ✓`);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n" + "=".repeat(52));
  console.log("  JagaID — OJK Data Importer");
  console.log("=".repeat(52));
  console.log(`  Env   : ${loadedEnv.envFile}`);
  console.log(`  Target: ${SUPABASE_URL}\n`);

  // Load scraped data
  const dataDir = path.join(__dirname, "..", "data");
  const dataPath = path.join(dataDir, "ojk-scraped.json");
  let raw: ScrapedEntity[];
  if (fs.existsSync(dataPath)) {
    raw = JSON.parse(fs.readFileSync(dataPath, "utf8")) as ScrapedEntity[];
    console.log(`  Loaded  : ${raw.length} scraped entities from ${dataPath}`);
  } else {
    raw = loadManualCsv(dataDir);
    if (raw.length === 0) {
      console.error(`  [import] ✗ No scraped data found at ${dataPath}`);
      console.error(
        `  Also found no importable rows in ${path.join(dataDir, "manual.csv")}.\n`
      );
      process.exit(1);
    }
    console.log(
      `  Loaded  : ${raw.length} manual entities from ${path.join(dataDir, "manual.csv")}`
    );
  }

  // Filter out obviously bad values
  const clean = raw.filter((e) => {
    const v = e.value.trim();
    if (v.length < 5) return false; // too short
    if (v.length > 200) return false; // too long
    if (/^[0\s]+$/.test(v)) return false; // all zeros
    return true;
  });

  console.log(`  After filter: ${clean.length} valid entities`);

  if (clean.length === 0) {
    console.error("\n  [import] ✗ Nothing to import after filtering.\n");
    process.exit(1);
  }

  // Show breakdown
  const byType = clean.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  console.log("\n  Breakdown by type:");
  Object.entries(byType).forEach(([t, n]) => console.log(`    ${t.padEnd(14)}: ${n}`));

  // Show current DB counts before import
  console.log("\n  Current DB state:");
  for (const t of ["entities", "connections", "reports"]) {
    console.log(`    ${t}: ${await countRows(t)} rows`);
  }

  console.log("\n  Starting import...\n");

  // Build entity rows and report rows
  const entityRows = clean.map((e) => toEntityRow(e));
  const reportRows = entityRows.map((entityRow, i) =>
    toReportRow(entityRow.id as string, clean[i])
  );

  // Insert entities first
  await insertBatched("entities", entityRows, "Entities");

  // Insert one report per entity (triggers report counter on entity)
  await insertBatched("reports", reportRows, "Reports ");

  // Final counts
  console.log("\n  Final DB state:");
  for (const t of ["entities", "connections", "reports"]) {
    console.log(`    ${t}: ${await countRows(t)} rows`);
  }

  console.log("\n  ✅  Import complete!");
  console.log("=".repeat(52) + "\n");
}

main().catch((err: unknown) => {
  console.error("\n  [import] ✗ Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
