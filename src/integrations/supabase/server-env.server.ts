/**
 * Server-only Supabase environment resolution.
 *
 * URL and publishable key fall back to VITE_* (injected at build time).
 * Service role is server-only and must be set in the deployment environment
 * (e.g. Vercel project settings) — never exposed to the client.
 */

function readViteEnv(name: string): string | undefined {
  try {
    const v = (import.meta as ImportMeta & { env?: Record<string, string> }).env?.[name];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

export function getSupabaseUrl(): string | undefined {
  return (
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    readViteEnv("VITE_SUPABASE_URL")
  );
}

export function getSupabasePublishableKey(): string | undefined {
  return (
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    readViteEnv("VITE_SUPABASE_PUBLISHABLE_KEY")
  );
}

export function getSupabaseServiceRoleKey(): string | undefined {
  return process.env.SUPABASE_SERVICE_ROLE_KEY;
}

export function getVapidPublicKeyEnv(): string | undefined {
  return process.env.VAPID_PUBLIC_KEY?.trim() || undefined;
}

export function getVapidPrivateKeyEnv(): string | undefined {
  return process.env.VAPID_PRIVATE_KEY?.trim() || undefined;
}

export function missingSupabaseEnvMessage(missing: string[]): string {
  return `Missing Supabase server environment variable(s): ${missing.join(", ")}. Configure them in your deployment environment (e.g. Vercel project settings).`;
}
