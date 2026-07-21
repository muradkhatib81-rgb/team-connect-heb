import { supabase } from "@/integrations/supabase/client";
import type { QueryClient } from "@tanstack/react-query";

export function shiftVisibleQueryKey(userId: string | null, branchId?: string | null) {
  return ["custody-board-visible", userId, branchId ?? null] as const;
}

/** Refetch custody/break self-service gates after shift or management-on-shift changes. */
export function invalidateShiftVisibleQueries(
  qc: QueryClient,
  userId: string,
  branchId?: string | null,
) {
  qc.invalidateQueries({ queryKey: shiftVisibleQueryKey(userId, branchId) });
  qc.invalidateQueries({ queryKey: ["custody-board-visible", userId] });
}

/**
 * UI gate shared by breaks + custody board. Never throws — returns false on any RPC failure.
 */
export async function fetchShiftSelfServiceVisible(branchId?: string | null): Promise<boolean> {
  try {
    // Prefer x-active-branch header (set by branch-scope) — never send null params
    // (PostgREST returns 400 for explicit null _branch_id).
    let { data, error } = await (supabase as any).rpc("is_custody_board_visible", {});
    if (error && branchId) {
      ({ data, error } = await (supabase as any).rpc("is_custody_board_visible", {
        _branch_id: branchId,
      }));
    }
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
