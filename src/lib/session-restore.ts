import { supabase } from "@/integrations/supabase/client";
import { isNativeApp } from "@/lib/native-app";

/**
 * Web persistSession writes `sb-*-auth-token` to localStorage.
 * Native uses persistSession:false (shared devices) — there is no durable
 * token, so a real document reload cannot be recovered.
 */
export function hasStoredBrowserAuthToken(): boolean {
  if (typeof window === "undefined") return false;
  if (isNativeApp()) return false;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith("sb-") || !key.includes("-auth-token")) continue;
      const raw = localStorage.getItem(key);
      if (raw && raw !== "null" && raw.length > 20) return true;
    }
  } catch {
    /* private mode */
  }
  return false;
}

/** Wait for supabase-js to finish reading persisted storage (web). */
export async function waitForClientSession() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

