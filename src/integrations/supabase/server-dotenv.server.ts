import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const SERVER_ENV_KEYS = new Set([
  "GEMINI_API_KEY",
  "GOOGLE_AI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "STRIPE_PRICE_STANDARD",
  "STRIPE_PRICE_ENTERPRISE",
]);

let loaded = false;

/** Dev fallback: TanStack Start workers may not inherit `.env` into process.env. */
function loadDotenvFallback() {
  if (loaded) return;
  loaded = true;

  try {
    const envPath = resolve(process.cwd(), ".env");
    if (!existsSync(envPath)) return;

    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      if (!SERVER_ENV_KEYS.has(key) || process.env[key]) continue;

      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  } catch {
    // Workers / production may not have filesystem access — rely on host env.
  }
}

export function readServerEnv(name: string): string | undefined {
  loadDotenvFallback();
  const value = process.env[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
