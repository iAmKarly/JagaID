import { NextRequest, NextResponse } from "next/server";
import { parse } from "csv-parse/sync";
import { supabaseAdmin } from "@/lib/supabase";
import { EntityTypeSchema } from "@/lib/validators";
import { normalizeQuery } from "@/lib/lookup";
import { isAuthorizedHeader } from "@/lib/auth";

// ── Admin key guard ───────────────────────────────────────────────────────────
// Header-only — query params get logged in URLs (browser history, access logs,
// referer headers) so we deliberately don't accept ?admin_key=… fallback.
function isAuthorized(req: NextRequest): boolean {
  return isAuthorizedHeader(req, "x-admin-key", "ADMIN_UPLOAD_KEY");
}

// ── CSV parser ────────────────────────────────────────────────────────────────
interface CsvRow {
  type: string;
  value: string;
  bank?: string;
  scam_type?: string;
}

function parseCsv(text: string): CsvRow[] {
  const records = parse(text, {
    columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  }) as Record<string, string>[];
  return records
    .filter((r) => r.value && r.value.trim().length > 0)
    .map((r) => ({
      type: r.type ?? "",
      value: r.value,
      bank: r.bank,
      scam_type: r.scam_type,
    }));
}

// ── Row validator ─────────────────────────────────────────────────────────────
const VALID_SCAM_TYPES = new Set([
  "Transfer Penipuan", "Investasi Bodong", "Phishing",
  "COD Palsu", "Pinjol Ilegal", "Belanja Online",
  "Lowongan Kerja Palsu", "Lainnya",
]);

function mapScamType(raw: string | undefined): string {
  if (!raw) return "Lainnya";
  if (VALID_SCAM_TYPES.has(raw)) return raw;
  const l = raw.toLowerCase();
  if (l.includes("investasi")) return "Investasi Bodong";
  if (l.includes("phish")) return "Phishing";
  if (l.includes("pinjol")) return "Pinjol Ilegal";
  if (l.includes("transfer")) return "Transfer Penipuan";
  return "Lainnya";
}

function mapEntityType(raw: string): "bank_account" | "phone" | "ewallet" | "domain" {
  const parsed = EntityTypeSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  const v = raw.toLowerCase().replace(/\s+/g, "_");
  if (v.includes("phone") || v.includes("hp") || v.includes("telp")) return "phone";
  if (v.includes("wallet") || v.includes("ewallet") || v.includes("gopay") || v.includes("ovo")) return "ewallet";
  if (v.includes("domain") || v.includes("url") || v.includes("web")) return "domain";
  return "bank_account";
}

const BATCH_SIZE = 50;

// ── Main handler ──────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let csvText: string;

  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded — send field name 'file'" }, { status: 400 });
    }
    csvText = await (file as File).text();
  } else {
    csvText = await request.text();
  }

  if (!csvText.trim()) {
    return NextResponse.json({ error: "Empty CSV" }, { status: 400 });
  }

  const rows = parseCsv(csvText);
  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No valid rows found. CSV must have header: type,value,bank,scam_type" },
      { status: 400 }
    );
  }

  const db = supabaseAdmin();
  const today = new Date().toISOString().split("T")[0];

  let entitiesProcessed = 0;
  let reportsAdded = 0;
  let skipped = 0;
  const errors: string[] = [];

  // Process in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);

    const entityInserts = batch
      .filter((r) => r.value && normalizeQuery(r.value).length >= 5)
      .map((r) => ({
        type: mapEntityType(r.type),
        value: normalizeQuery(r.value),
        bank: r.bank?.trim() || null,
        reports: 0,
        last_seen: today,
        // Tag the source so dashboards can distinguish admin-imported rows
        // from community submissions or scraped data. confidence=90 since
        // admin-curated CSVs are higher trust than scraper output but lower
        // than direct OJK API integrations would be.
        source: "admin",
        confidence: 90,
        created_at: new Date().toISOString(),
      }));

    if (entityInserts.length === 0) continue;

    // ── Upsert entities, ignoring duplicates ────────────────────────────────
    // CRITICAL: ignoreDuplicates=true. Previously this was false (= MERGE),
    // which silently overwrote `reports: 0` on existing entities — destroying
    // accumulated counts on every re-upload. With ignoreDuplicates=true,
    // existing rows are untouched; only genuinely new (type, value) pairs
    // get inserted. Existing rows still get a fresh report row appended below,
    // which the DB trigger uses to bump their report count by exactly 1.
    const { error: entityError } = await db
      .from("entities")
      .upsert(entityInserts, { onConflict: "type,value", ignoreDuplicates: true });

    if (entityError) {
      errors.push(`Batch ${i / BATCH_SIZE + 1}: ${entityError.message}`);
      skipped += entityInserts.length;
      continue;
    }

    // ── Look up IDs for every (type, value) in this batch ───────────────────
    // We need IDs for both newly-inserted AND pre-existing entities so we can
    // attach a fresh report row to each. The .in("value", ...) query uses the
    // new idx_entities_value index from migration 003.
    const batchValues = entityInserts.map((e) => e.value);
    const { data: rowsForIds, error: lookupError } = await db
      .from("entities")
      .select("id, type, value")
      .in("value", batchValues);

    if (lookupError) {
      errors.push(`Lookup batch ${i / BATCH_SIZE + 1}: ${lookupError.message}`);
      skipped += entityInserts.length;
      continue;
    }

    const valueToId = new Map(
      (rowsForIds ?? []).map((e) => [`${e.type}:${e.value}`, e.id as string])
    );

    // ── Build report rows ───────────────────────────────────────────────────
    // One report per CSV row; the DB trigger increments entities.reports.
    const reportInserts = batch
      .filter((r) => {
        const key = `${mapEntityType(r.type)}:${normalizeQuery(r.value)}`;
        return r.value && valueToId.has(key);
      })
      .map((r) => ({
        entity_id: valueToId.get(`${mapEntityType(r.type)}:${normalizeQuery(r.value)}`)!,
        type: mapScamType(r.scam_type),
        amount: null,
        date: today,
        description: `Data publik diimpor dari OJK/otoritas terkait via CSV upload.`,
        source: "admin",
        confidence: 90,
      }));

    if (reportInserts.length > 0) {
      const { error: reportError } = await db
        .from("reports")
        .insert(reportInserts);

      if (reportError) {
        errors.push(`Reports batch ${i / BATCH_SIZE + 1}: ${reportError.message}`);
      } else {
        reportsAdded += reportInserts.length;
      }
    }

    entitiesProcessed += entityInserts.length;
  }

  return NextResponse.json({
    success: true,
    summary: {
      total_rows: rows.length,
      entities_processed: entitiesProcessed,
      reports_added: reportsAdded,
      skipped,
      errors: errors.length > 0 ? errors : undefined,
    },
  }, { status: 200 });
}
