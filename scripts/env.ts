import * as dotenv from "dotenv";
import * as fs from "fs";
import * as path from "path";

export interface LoadedScriptEnv {
  envFile: ".env.local" | ".env.test";
  envPath: string;
}

function wantsTestEnv(argv: string[]): boolean {
  return (
    argv.includes("--test") ||
    argv.includes("--env=test") ||
    process.env.JAGAID_ENV === "test"
  );
}

export function loadSupabaseScriptEnv(scriptName: string): LoadedScriptEnv {
  const envFile = wantsTestEnv(process.argv) ? ".env.test" : ".env.local";
  const envPath = path.join(__dirname, "..", envFile);
  const exampleFile = envFile === ".env.test" ? ".env.test.example" : ".env.example";

  const result = dotenv.config({ path: envPath });
  if (result.error && !fs.existsSync(envPath)) {
    console.error(`\n  [${scriptName}] ✗ Missing ${envFile}`);
    if (envFile === ".env.test") {
      console.error(
        `  Create it from ${exampleFile}, or omit --test to use .env.local.\n`
      );
    } else {
      console.error(`  Create it from ${exampleFile}.\n`);
    }
    process.exit(1);
  }

  return { envFile, envPath };
}
