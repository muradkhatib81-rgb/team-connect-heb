import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  fetchShiftSelfServiceVisible,
  shiftVisibleQueryKey,
} from "@/lib/shift-visible-rpc";
import { useCanUserRequestBreak } from "@/lib/break-permissions";

/** Open break statuses — inlined to avoid circular imports from break-workflow. */
const OPEN_BREAK_NAV_STATUSES = new Set([
  "active",
  "scheduled",
  "approved",
  "waiting_for_start",
  "pending_approval",
  "pending",
]);

/**
 * UI gate for employee self-service (break request card, custody board).
 * Reuses the existing is_custody_board_visible RPC — no permission or schedule changes.
 */
export function useShiftSelfServiceVisible() {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;
  const userId = profile?.id ?? null;
  const onLeave = !!profile?.on_leave;

  const visibleQ = useQuery({
    enabled: !!userId && !onLeave,
    queryKey: shiftVisibleQueryKey(userId, scopedBranchId),
    queryFn: () => fetchShiftSelfServiceVisible(scopedBranchId),
    staleTime: 30_000,
    retry: false,
  });

  return {
    isVisible: !!profile && !onLeave && visibleQ.data === true,
    isLoading: !!profile && !onLeave && visibleQ.isLoading,
  };
}

export { useCanUserRequestBreak } from "@/lib/break-permissions";

/**
 * Sidebar / breaks page gate: on-shift (or not on leave) plus open break requests
 * so users can still reach /breaks to view or end an active break.
 */
export function useBreakSelfServiceNavVisible() {
  const shift = useShiftSelfServiceVisible();
  const canRequestQ = useCanUserRequestBreak();
  const { data: profile } = useAuth();
  const userId = profile?.id ?? null;

  const openQ = useQuery({
    enabled: !!userId && !shift.isVisible && !shift.isLoading,
    queryKey: ["my-open-break-nav", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("status")
        .eq("user_id", userId!)
        .limit(30);
      if (error) return false;
      return (data ?? []).some((r) => OPEN_BREAK_NAV_STATUSES.has(r.status));
    },
    staleTime: 30_000,
    retry: false,
  });

  const canRequestBreak = canRequestQ.data === true;

  return {
    isVisible: (shift.isVisible && canRequestBreak) || openQ.data === true,
    isLoading:
      shift.isLoading ||
      canRequestQ.isLoading ||
      (!shift.isVisible && canRequestQ.data !== true && openQ.isLoading),
    isOnShift: shift.isVisible,
    canRequestBreak,
  };
}
