import { supabase } from "@/integrations/supabase/client";

export function shiftVisibleQueryKey(userId: string | null, branchId?: string | null) {
  return ["custody-board-visible", userId, branchId ?? null] as const;
}

/**
 * UI gate shared by breaks + custody board. Never throws — returns false on any RPC failure.
 */
export async function fetchShiftSelfServiceVisible(branchId?: string | null): Promise<boolean> {
  try {
    const withBranch = branchId ? { _branch_id: branchId } : {};
    let { data, error } = await (supabase as any).rpc("is_custody_board_visible", withBranch);
    if (error && branchId) {
      ({ data, error } = await (supabase as any).rpc("is_custody_board_visible", {}));
    }
    if (error) return false;
    return !!data;
  } catch {
    return false;
  }
}
