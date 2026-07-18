/**
 * Active Branch — client-side header propagation for server functions.
 *
 * Browser stores the selected branch in localStorage (managed by
 * `useActiveBranch`). `attachActiveBranch` attaches `X-Active-Branch`
 * to every server-function call. Server-side validation lives in
 * `active-branch.server.ts` (`requireBranchContext`).
 */
import { createMiddleware } from "@tanstack/react-start";

const STORAGE_KEY = "lov_active_branch_id";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 * headers when an active branch is set.
 */
export const attachActiveBranch = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    const id = readActiveBranchId();
    return next(id ? { headers: { "X-Active-Branch": id } } : {});
  },
);

/**
 * Realtime WebSocket cannot carry per-channel headers, so use this
 * postgres_changes filter helper to scope subscriptions to the active branch.
 */
export function branchScopedFilter(branchId: string | null): string | undefined {
  return branchId ? `branch_id=eq.${branchId}` : undefined;
}
