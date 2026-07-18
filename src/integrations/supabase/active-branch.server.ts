/**
 * Server-side active-branch middleware. Import only from server functions
 * (*.functions.ts) — never from browser routes or components.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireSupabaseAuth } from "./auth-middleware";
import { getSupabasePublishableKey, getSupabaseUrl } from "./server-env.server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLISHABLE_KEY = getSupabasePublishableKey();

/**
 * Server middleware that depends on `requireSupabaseAuth`. After the
 * caller is authenticated, it reads the (untrusted) X-Active-Branch
 * header, validates UUID shape, and re-creates a Supabase client whose
 * PostgREST traffic carries the header.
 */
export const requireBranchContext = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return next({ context: { ...context, branchId: null as string | null } });
    }

    const request = getRequest();
    const rawHeader = request?.headers.get("x-active-branch") ?? "";
    const headerBranchId = UUID_RE.test(rawHeader) ? rawHeader : null;

    const auth = request?.headers.get("authorization") ?? "";
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = auth;
    if (headerBranchId) headers["x-active-branch"] = headerBranchId;

    const scoped = createClient<Database>(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        global: { headers },
        auth: {
          storage: undefined,
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );

    let resolvedBranchId: string | null = headerBranchId;
    if (!headerBranchId) {
      try {
        const { data } = await scoped.rpc("current_active_branch" as never);
        resolvedBranchId = (data as string | null) ?? null;
      } catch {
        resolvedBranchId = null;
      }
    }

    return next({ context: { ...context, supabase: scoped, branchId: resolvedBranchId } });
  });
