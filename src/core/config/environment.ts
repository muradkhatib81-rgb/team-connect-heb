/** Environment abstraction — no Supabase or connection-specific values here. */

export type AppEnvironment = "development" | "test" | "production";

export function getEnvironment(): AppEnvironment {
  const mode = typeof import.meta !== "undefined" ? import.meta.env?.MODE : undefined;
  if (mode === "production") return "production";
  if (mode === "test") return "test";
  return "development";
}

export function isProduction(): boolean {
  return getEnvironment() === "production";
}
