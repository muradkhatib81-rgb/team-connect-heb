/**
 * Active Branch — header propagation for server functions and PostgREST.
 *
 * The browser stores the selected branch in localStorage (managed by
 * `useActiveBranch`). Two pieces of middleware translate that into a
 * real server-side scope:
 *
 *   1. `attachActiveBranch` (client functionMiddleware) attaches the
 *      `X-Active-Branch` header to every server-function call.
 *
 *   2. `requireBranchContext` (server middleware) chains after
 *      `requireSupabaseAuth`, validates the header as a UUID and
 *      re-issues a Supabase client whose PostgREST requests carry the
 *      header. The `public.current_active_branch()` function reads it
 *      and the RESTRICTIVE RLS policies enforce branch isolation —
 *      including against tampering (non–system-admins are pinned to
 *      their profile branch in SQL, the header is ignored for them).
 *
 * Server functions opt in by replacing
 *   `.middleware([requireSupabaseAuth])`
 * with
 *   `.middleware([requireBranchContext])`
 *
 * `context.supabase` then transparently performs every query under the
 * active branch. `context.branchId` exposes the resolved value for
 * code paths that need to stamp it onto inserts.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { requireSupabaseAuth } from "./auth-middleware";
import { supabase } from "./client";

const STORAGE_KEY = "lov_active_branch_id";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- Client side -----------------------------------------------------

/**
 * Read the currently selected branch synchronously. Used by the client
 * middleware (no React, no async) so it can attach the header before
 * the server function call is sent.
 */
export function readActiveBranchId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Functional middleware that runs on the client just before a server
 * function is dispatched. Appends `X-Active-Branch` to the request
 * headers when an active branch is set. Idempotent and safe to combine
 * with the existing bearer-token attacher (TanStack merges headers).
 */
export const attachActiveBranch = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const id = readActiveBranchId();
    return next(id ? { headers: { "X-Active-Branch": id } } : {});
  },
);

// ---- Server side -----------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY;

/**
 * Server middleware that depends on `requireSupabaseAuth`. After the
 * caller is authenticated, it reads the (untrusted) X-Active-Branch
 * header, validates UUID shape, and re-creates a Supabase client whose
 * PostgREST traffic carries the header. The database (`current_active_branch()`
 * + RESTRICTIVE policies) then enforces:
 *
 *   - System admin: scoped to the requested branch, or unrestricted
 *     when no header is sent (branches list view).
 *   - Branch manager / department manager / employee: header is
 *     ignored at the SQL layer; always restricted to their own
 *     profile.branch_id. Tampering is harmless.
 *
 * `context.branchId` exposes the validated header for code that needs
 * to stamp branch_id explicitly. The default-branch trigger handles
 * the common case automatically.
 */
export const requireBranchContext = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      // Cannot reissue client; fall back to the auth-only client.
      return next({ context: { ...context, branchId: null as string | null } });
    }

    const request = getRequest();
    const rawHeader = request?.headers.get("x-active-branch") ?? "";
    const branchId = UUID_RE.test(rawHeader) ? rawHeader : null;

    const auth = request?.headers.get("authorization") ?? "";
    const headers: Record<string, string> = {};
    if (auth) headers.Authorization = auth;
    if (branchId) headers["X-Active-Branch"] = branchId;

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

    return next({ context: { ...context, supabase: scoped, branchId } });
  });

// ---- Realtime helper -------------------------------------------------

/**
 * The Realtime WebSocket cannot carry per-channel headers, so RLS for
 * realtime falls back to the JWT only. System admins would otherwise
 * receive INSERT/UPDATE/DELETE events for every branch. Use this
 * postgres_changes filter helper to scope subscriptions to the active
 * branch. Non–system-admins always pass their profile branch.
 */
export function branchScopedFilter(branchId: string | null): string | undefined {
  return branchId ? `branch_id=eq.${branchId}` : undefined;
}

// Re-export the client supabase for convenience in code paths that
// only need browser access.
export { supabase };
