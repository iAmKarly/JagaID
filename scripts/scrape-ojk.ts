/**
 * scripts/scrape-ojk.ts
 *
 * Scrapes publicly available Indonesian fraud/scam data from:
 *   1. OJK Investor Alert Portal (sikapiuangmu.ojk.go.id)
 *   2. Satgas Waspada Investasi press releases (ojk.go.id)
 *   3. PatroliSiber.id public scam list
 *
 * OJK blocks plain axios requests with 403 — this scraper uses
 * realistic browser headers + a short delay between requests.
 *
 * Output: data/ojk-scraped.json  (ready to import via import-ojk.ts)
 *
 * Run with:
 *   npm run scrape:ojk
 *   npm run scrape
 */

import axios, { AxiosInstance } from "axios";
import * as cheerio from "cheerio";
import * as fs from "fs";
import * as path from "path";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface ScrapedEntity {
  type: "bank_account" | "phone" | "ewallet" | "domain";
  value: string;
  bank?: string;
  scam_type: string;
  source: string;
  /**
   * 0–100 score of how trusted this row is.
   *   90  manual CSV (curated by hand)
   *   60  table-row extraction from OJK alert portal (structured data)
   *   50  PatroliSiber report listings
   *   30  body-text regex with explicit keyword context
   *   20  uncategorised body-text matches (no longer used — see scrapeOjkSwi)
   * Downstream (import-ojk.ts, /admin/upload) writes this through to the DB.
   */
  confidence: number;
  scraped_at: string;
}

// ── HTTP client with browser-like headers ─────────────────────────────────────
function makeClient(): AxiosInstance {
  return axios.create({
    timeout: 20_000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
      "Accept-Encoding": "gzip, deflate, br",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
    maxRedirects: 5,
  });
}

const client = makeClient();
const NOW = new Date().toISOString();

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeValue(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w.\-:@]/g, "");
}

function detectType(value: string): ScrapedEntity["type"] {
  if (/^https?:\/\/|^www\.|\.com|\.id|\.net|\.org/i.test(value)) return "domain";
  if (/^08|^\+62|^628/.test(value)) return "phone";
  if (/gopay|ovo|dana|shopeepay/i.test(value)) return "ewallet";
  return "bank_account";
}

/**
 * Extract bank account candidates from arbitrary HTML body text.
 *
 * Previous approach was a flat `\d{10,16}` match across the whole body, which
 * picked up pagination numbers, dates, document IDs, copyright years — anything
 * 10–16 digits long. That polluted the database with false positives.
 *
 * New approach: only accept digit runs that appear within ~50 characters of an
 * Indonesian banking keyword (rekening, a.n., norek, atas nama) or a major
 * bank name (BCA, BRI, BNI, Mandiri, BSI, CIMB, Permata, Danamon, BTN). If we
 * can identify the bank from the surrounding text, we attach it.
 */
function extractBankAccountsWithContext(
  text: string
): Array<{ value: string; bank?: string }> {
  const banks = [
    "BCA",
    "BRI",
    "BNI",
    "Mandiri",
    "BSI",
    "CIMB",
    "Permata",
    "Danamon",
    "BTN",
  ];
  const keywords = [
    "rekening",
    "no\\.\\s*rek",
    "norek",
    "no\\.?\\s*rekening",
    "a\\.\\s*n\\.?",
    "a/n",
    "atas nama",
    ...banks,
  ];
  const keywordPattern = keywords.join("|");
  // Capture: keyword, then up to 80 chars of any character (incl. newlines), then 10–16 digits.
  const re = new RegExp(`(${keywordPattern})[\\s\\S]{0,80}?\\b(\\d{10,16})\\b`, "gi");

  const out: Array<{ value: string; bank?: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const ctxKeyword = m[1];
    const num = m[2];
    // Find a bank name within 80 chars of the match window — use it as the bank.
    const window = text.slice(
      Math.max(0, m.index - 40),
      m.index + (m[0]?.length ?? 0) + 40
    );
    const bankMatch = banks.find((b) => new RegExp(`\\b${b}\\b`, "i").test(window));
    out.push({
      value: num,
      bank:
        bankMatch ??
        banks.find((b) => b.toLowerCase() === ctxKeyword.toLowerCase()) ??
        undefined,
    });
  }
  return out;
}

function deduplicateEntities(entities: ScrapedEntity[]): ScrapedEntity[] {
  const seen = new Set<string>();
  return entities.filter((e) => {
    const key = `${e.type}:${e.value.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── Source 1: OJK Investor Alert Portal ──────────────────────────────────────
async function scrapeOjkAlertPortal(): Promise<ScrapedEntity[]> {
  const SOURCE = "OJK Investor Alert Portal";
  const URL = "https://sikapiuangmu.ojk.go.id/FrontEnd/AlertPortal/Negative";
  console.log(`\n[scrape] ${SOURCE}`);

  try {
    // First GET the page to grab cookies/session
    const r = await client.get(URL);
    const $ = cheerio.load(r.data as string);
    const results: ScrapedEntity[] = [];

    // Table rows — OJK lists company names + URLs of illegal entities.
    // Confidence 60: structured data, but the column we read is heuristic
    // (sometimes the URL is in column 2, sometimes column 3).
    $("table tbody tr").each((_i, row) => {
      const cells = $(row).find("td");
      if (cells.length < 2) return;

      const name = $(cells[0]).text().trim();
      const urlOrPhone = $(cells[1]).text().trim();

      [name, urlOrPhone].forEach((raw) => {
        const val = normalizeValue(raw);
        if (!val || val.length < 4) return;
        const type = detectType(val);
        // Skip company names that aren't actually URLs/phones/accounts
        if (type === "bank_account" && !/^\d{10,16}$/.test(val)) return;
        results.push({
          type,
          value: val,
          scam_type: "Investasi Bodong",
          source: SOURCE,
          confidence: 60,
          scraped_at: NOW,
        });
      });
    });

    // Phones and domains from paragraphs/lists — these patterns are specific
    // enough (phone format, TLD) to keep at confidence 50.
    $("p, li, td").each((_i, el) => {
      const text = $(el).text();
      const phones = text.match(/08\d{8,11}|\+62\d{8,11}/g) ?? [];
      phones.forEach((phone) => {
        results.push({
          type: "phone",
          value: phone,
          scam_type: "Investasi Bodong",
          source: SOURCE,
          confidence: 50,
          scraped_at: NOW,
        });
      });
      const domains =
        text.match(
          /(?:https?:\/\/)?(?:www\.)?[\w-]+\.(?:com|id|net|org|co\.id)(?:\/\S*)?/gi
        ) ?? [];
      domains.forEach((domain) => {
        const val = domain.replace(/^https?:\/\/(www\.)?/, "").split("/")[0];
        if (val.length > 4)
          results.push({
            type: "domain",
            value: val,
            scam_type: "Investasi Bodong",
            source: SOURCE,
            confidence: 50,
            scraped_at: NOW,
          });
      });
    });

    console.log(`[scrape] ✓ Found ${results.length} raw entities`);
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scrape] ✗ ${SOURCE}: ${msg}`);
    console.warn(
      `[scrape]   Tip: OJK blocks automated requests. Try running with a VPN or from a browser-controlled environment.`
    );
    return [];
  }
}

// ── Source 2: OJK SWI (Satgas Waspada Investasi) press releases ───────────────
async function scrapeOjkSwi(): Promise<ScrapedEntity[]> {
  const SOURCE = "OJK SWI Press Release";
  console.log(`\n[scrape] ${SOURCE}`);
  await sleep(2_000);

  try {
    const r = await client.get(
      "https://www.ojk.go.id/id/berita-dan-kegiatan/siaran-pers?page=1"
    );
    const $ = cheerio.load(r.data as string);
    const results: ScrapedEntity[] = [];

    // Press release body text. Bank account extraction must use keyword
    // context (rekening / a.n. / bank name) — flat \d{10,16} matches across
    // body text was the source of the bulk of our false positives.
    const fullText = $("body").text();

    // Phones: pattern is specific enough to use directly (08 prefix + length).
    const phones = fullText.match(/08\d{8,11}/g) ?? [];
    phones.forEach((p) =>
      results.push({
        type: "phone",
        value: p,
        scam_type: "Investasi Bodong",
        source: SOURCE,
        confidence: 40,
        scraped_at: NOW,
      })
    );

    // Bank accounts: only if a banking keyword appears within ~80 chars.
    extractBankAccountsWithContext(fullText).forEach(({ value, bank }) => {
      results.push({
        type: "bank_account",
        value,
        bank,
        scam_type: "Transfer Penipuan",
        source: SOURCE,
        confidence: 30,
        scraped_at: NOW,
      });
    });

    // Domains: TLD pattern is specific.
    const domains = fullText.match(/[\w-]+\.(?:com|id|net|org|co\.id)/gi) ?? [];
    domains.forEach((d) =>
      results.push({
        type: "domain",
        value: d,
        scam_type: "Investasi Bodong",
        source: SOURCE,
        confidence: 40,
        scraped_at: NOW,
      })
    );

    console.log(`[scrape] ✓ Found ${results.length} raw entities`);
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scrape] ✗ ${SOURCE}: ${msg}`);
    return [];
  }
}

// ── Source 3: PatroliSiber (Indonesian cyber patrol) ─────────────────────────
async function scrapePatroliSiber(): Promise<ScrapedEntity[]> {
  const SOURCE = "PatroliSiber.id";
  console.log(`\n[scrape] ${SOURCE}`);
  await sleep(2_000);

  try {
    const r = await client.get("https://www.patrolisiber.id/report");
    const $ = cheerio.load(r.data as string);
    const results: ScrapedEntity[] = [];

    // PatroliSiber lists reported URLs and accounts in table rows
    $("table tbody tr, .report-item, .fraud-item").each((_i, el) => {
      const text = $(el).text().trim();
      if (!text) return;

      const phones = text.match(/08\d{8,11}/g) ?? [];
      const urls = text.match(/[\w-]+\.(?:com|id|net|org)/gi) ?? [];

      phones.forEach((p) =>
        results.push({
          type: "phone",
          value: p,
          scam_type: "Phishing",
          source: SOURCE,
          confidence: 50,
          scraped_at: NOW,
        })
      );
      urls.forEach((u) =>
        results.push({
          type: "domain",
          value: u,
          scam_type: "Phishing",
          source: SOURCE,
          confidence: 50,
          scraped_at: NOW,
        })
      );

      // Bank accounts only with context — PatroliSiber pages mix phone/IDs/account numbers.
      extractBankAccountsWithContext(text).forEach(({ value, bank }) =>
        results.push({
          type: "bank_account",
          value,
          bank,
          scam_type: "Phishing",
          source: SOURCE,
          confidence: 50,
          scraped_at: NOW,
        })
      );
    });

    console.log(`[scrape] ✓ Found ${results.length} raw entities`);
    return results;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[scrape] ✗ ${SOURCE}: ${msg}`);
    return [];
  }
}

// ── Source 4: Manual CSV fallback ─────────────────────────────────────────────
// If all live scrapes fail (403s), you can drop a CSV file at data/manual.csv
// with columns: type,value,bank,scam_type
// This function will pick it up automatically. Confidence 90 because a human
// curated each row.
function loadManualCsv(): ScrapedEntity[] {
  const csvPath = path.join(__dirname, "..", "data", "manual.csv");
  if (!fs.existsSync(csvPath)) return [];

  console.log(`\n[scrape] Loading manual CSV: ${csvPath}`);
  const lines = fs.readFileSync(csvPath, "utf8").split("\n").filter(Boolean);
  const [header, ...rows] = lines;
  const cols = header.split(",").map((c) => c.trim());

  const results: ScrapedEntity[] = [];
  rows.forEach((line, i) => {
    const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row = Object.fromEntries(cols.map((c, j) => [c, vals[j] ?? ""]));

    if (!row.value) return;
    results.push({
      type: (row.type as ScrapedEntity["type"]) || detectType(row.value),
      value: row.value,
      bank: row.bank || undefined,
      scam_type: row.scam_type || "Lainnya",
      source: `Manual CSV (row ${i + 2})`,
      confidence: 90,
      scraped_at: NOW,
    });
  });

  console.log(`[scrape] ✓ Loaded ${results.length} entities from manual CSV`);
  return results;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=".repeat(52));
  console.log("  JagaID — OJK Data Scraper");
  console.log("=".repeat(52));

  const outDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const all: ScrapedEntity[] = [];

  // Run all scrapers
  all.push(...(await scrapeOjkAlertPortal()));
  all.push(...(await scrapeOjkSwi()));
  all.push(...(await scrapePatroliSiber()));
  all.push(...loadManualCsv());

  // Deduplicate
  const deduped = deduplicateEntities(all);

  console.log(`\n[scrape] ── Summary ─────────────────────────────`);
  console.log(`[scrape]   Raw collected : ${all.length}`);
  console.log(`[scrape]   After dedup   : ${deduped.length}`);

  // Breakdown by type
  const byType = deduped.reduce(
    (acc, e) => {
      acc[e.type] = (acc[e.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  Object.entries(byType).forEach(([t, n]) =>
    console.log(`[scrape]   ${t.padEnd(14)}: ${n}`)
  );

  // Write output
  const outPath = path.join(outDir, "ojk-scraped.json");
  fs.writeFileSync(outPath, JSON.stringify(deduped, null, 2), "utf8");
  console.log(`\n[scrape] ✅ Saved ${deduped.length} entities → ${outPath}`);

  if (deduped.length === 0) {
    console.log(`
[scrape] ⚠️  Zero entities scraped. OJK likely blocked the request (403).
[scrape]   Options:
[scrape]   1. Run this from a browser environment (Puppeteer/Playwright)
[scrape]   2. Download OJK's PDF list manually and place at data/manual.csv
[scrape]   3. Use the manual CSV format:
[scrape]      type,value,bank,scam_type
[scrape]      domain,investasi-palsu.com,,Investasi Bodong
[scrape]      bank_account,1234567890,BRI,Transfer Penipuan
[scrape]      phone,08123456789,,Phishing
[scrape]   Then run: npm run import:ojk
    `);
  } else {
    console.log(`[scrape]   Next step: npm run import:ojk`);
  }
  console.log("=".repeat(52));
}

main().catch((err: unknown) => {
  console.error("[scrape] ✗ Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
