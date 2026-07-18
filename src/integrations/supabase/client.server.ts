// Server-side Supabase client with service role key — bypasses RLS.
// Use only for trusted server operations (auth admin, storage admin).
// User-authenticated queries must use requireSupabaseAuth / requireBranchContext.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import {
  getSupabaseServiceRoleKey,
  getSupabaseUrl,
  missingSupabaseEnvMessage,
} from "./server-env.server";

function createSupabaseAdminClient() {
  const SUPABASE_URL = getSupabaseUrl();
  const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey();

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_SERVICE_ROLE_KEY ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
    ];
    const message = missingSupabaseEnvMessage(missing);
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }

  return createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

let _supabaseAdmin: ReturnType<typeof createSupabaseAdminClient> | undefined;

export const supabaseAdmin = new Proxy({} as ReturnType<typeof createSupabaseAdminClient>, {
  get(_, prop, receiver) {
    if (!_supabaseAdmin) _supabaseAdmin = createSupabaseAdminClient();
    return Reflect.get(_supabaseAdmin, prop, receiver);
  },
});
