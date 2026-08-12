/**
 * scripts/reset-db.ts
 * Deletes all seed/test data from Supabase, keeping schema intact.
 * Run with: npx ts-node --project tsconfig.scripts.json scripts/reset-db.ts
 * Test DB: npm run reset:db -- --test
 *
 * WARNING: This deletes ALL rows from reports, connections, and entities.
 * There is a confirmation prompt — you must type "yes" to proceed.
 */

import * as readline from "readline";
import { loadSupabaseScriptEnv } from "./env";

const loadedEnv = loadSupabaseScriptEnv("reset");

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(`\n  [reset] ✗ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in ${loadedEnv.envFile}\n`);
  process.exit(1);
}

async function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(ans.trim()); });
  });
}

async function deleteAll(table: string): Promise<number> {
  // Supabase REST: DELETE with filter neq id (matches everything)
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=representation",
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`DELETE ${table} failed (HTTP ${res.status}): ${body}`);
  }

  const deleted = await res.json() as unknown[];
  return deleted.length;
}

async function countRows(table: string): Promise<number> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id`, {
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Prefer": "count=exact",
      Range: "0-0",
    },
  });
  const count = res.headers.get("content-range")?.split("/")?.[1];
  return parseInt(count ?? "0", 10);
}

async function main() {
  console.log("\n" + "=".repeat(52));
  console.log("  JagaID — Database Reset");
  console.log("=".repeat(52));
  console.log(`  Env   : ${loadedEnv.envFile}`);
  console.log(`  Target: ${SUPABASE_URL}\n`);

  // Show current counts
  console.log("  Current row counts:");
  for (const t of ["entities", "connections", "reports"]) {
    const n = await countRows(t);
    console.log(`    ${t}: ${n} rows`);
  }

  console.log("\n  ⚠️  This will DELETE ALL ROWS from reports, connections, and entities.");
  const answer = await ask("  Type 'yes' to confirm: ");

  if (answer.toLowerCase() !== "yes") {
    console.log("\n  Aborted — no data was deleted.\n");
    process.exit(0);
  }

  console.log("");

  // Delete in FK-safe order: reports → connections → entities
  process.stdout.write("  [reset] Deleting reports... ");
  const rCount = await deleteAll("reports");
  console.log(`✓ (${rCount} deleted)`);

  process.stdout.write("  [reset] Deleting connections... ");
  const cCount = await deleteAll("connections");
  console.log(`✓ (${cCount} deleted)`);

  process.stdout.write("  [reset] Deleting entities... ");
  const eCount = await deleteAll("entities");
  console.log(`✓ (${eCount} deleted)`);

  console.log("\n  ✅  Database cleared. Ready for real data.");
  console.log("=".repeat(52) + "\n");
}

main().catch((err: unknown) => {
  console.error("\n  [reset] ✗ Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
