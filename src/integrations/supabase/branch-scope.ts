/**
 * Active-branch scoping for the Supabase client.
 *
 * Patches `supabase.from(table)` so that for every table that owns a
 * `branch_id` column, all reads/updates/deletes are transparently filtered
 * to the currently active branch, and inserts/upserts auto-receive
 * `branch_id` when the caller has not set it explicitly.
 *
 * This lets the System Administrator switch branches from the header and
 * have every page show data scoped to that branch — without touching the
 * dozens of call sites that already use `supabase.from(...)`.
 *
 * Notes:
 *  - Tables without `branch_id` are passed through untouched.
 *  - Calls that already include `branch_id` in their payload or filters
 *    keep their explicit value (we never override).
 *  - When no branch is active yet (initial boot), the client behaves
 *    exactly like the unpatched version.
 */
import { supabase } from "./client";

// Every public table that owns a `branch_id` column. Keep in sync with the
// schema; queries against any other table are left untouched.
const BRANCH_SCOPED_TABLES = new Set<string>([
  
  "break_requests",
  "break_settings",
  "communications_audit_log",
  "company_settings",
  "departments",
  "employee_archive",
  "employee_of_month",
  "job_titles",
  "messages",
  "profile_status_log",
  "profiles",
  "schedule_audit_log",
  "schedule_notifications",
  "schedule_shifts",
  "schedules",
  "shift_definitions",
  "shift_definition_day_hours",
  "task_activity_log",
  "task_recurrences",
  "tasks",
  // NOTE: user_task_permissions is intentionally NOT branch-scoped here.
  // It's keyed by user_id (one row per user). Scoping it by active branch
  // hides a manager's own permissions after a profile reassignment and
  // makes the Permissions card / management buttons disappear. RLS on the
  // table already restricts visibility (own row + main_admin).
]);

let activeBranchId: string | null = null;
let patched = false;

function syncSupabaseBranchHeader(id: string | null) {
  try {
    const rest = (supabase as { rest?: { headers?: Record<string, string> } }).rest;
    if (!rest) return;
    if (!rest.headers) rest.headers = {};
    if (id) rest.headers["x-active-branch"] = id;
    else delete rest.headers["x-active-branch"];
  } catch {
    // non-fatal
  }
}

export function setActiveBranchScope(id: string | null) {
  activeBranchId = id;
  syncSupabaseBranchHeader(id);
}

export function getActiveBranchScope(): string | null {
  return activeBranchId;
}

function patchInsertPayload(payload: unknown, branchId: string): unknown {
  const patchRow = (row: unknown) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    if ("branch_id" in (row as Record<string, unknown>)) return row;
    return { branch_id: branchId, ...(row as Record<string, unknown>) };
  };
  if (Array.isArray(payload)) return payload.map(patchRow);
  return patchRow(payload);
}

function wrapBuilder(builder: unknown, branchId: string): unknown {
  return new Proxy(builder as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      if (prop === "insert" || prop === "upsert") {
        return (...args: unknown[]) => {
          if (args.length > 0) args[0] = patchInsertPayload(args[0], branchId);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      if (prop === "select" || prop === "update" || prop === "delete") {
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (
            result &&
            typeof (result as { eq?: unknown }).eq === "function"
          ) {
            return (result as { eq: (c: string, v: string) => unknown }).eq(
              "branch_id",
              branchId,
            );
          }
          return result;
        };
      }
      return value;
    },
  });
}

let originalFrom: ((table: string) => unknown) | null = null;

/**
 * Bypass the branch-scope proxy for a single query. Use when fetching a
 * row by primary key that may legitimately live in a different branch
 * (e.g. the signed-in user's own profile while a sysadmin is viewing
 * another branch).
 */
export function unscopedFrom(table: string): unknown {
  if (originalFrom) return originalFrom(table);
  return (supabase as unknown as { from: (t: string) => unknown }).from(table);
}

/**
 * Idempotently install the proxy. Safe to import many times; only the
 * first call rewrites `supabase.from`.
 */
export function installBranchScope() {
  if (patched) return;
  patched = true;
  const client = supabase as unknown as {
    from: (table: string) => unknown;
  };
  originalFrom = client.from.bind(supabase);
  client.from = (table: string) => {
    const builder = originalFrom!(table);
    if (!activeBranchId || !BRANCH_SCOPED_TABLES.has(table)) return builder;
    return wrapBuilder(builder, activeBranchId);
  };
}
