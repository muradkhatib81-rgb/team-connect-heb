import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  custodyVisibleQueryKey,
  fetchCustodyBoardVisible,
} from "@/lib/custody-workflow";
import {
  BREAK_PENDING_APPROVAL_STATUSES,
  BREAK_PRE_ACTIVE_STATUSES,
} from "@/lib/break-workflow";

/**
 * UI gate for employee self-service (break request card, custody board).
 * Reuses the existing is_custody_board_visible RPC — no permission or schedule changes.
 */
export function useShiftSelfServiceVisible() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;
  const userId = profile?.id ?? null;
  const onLeave = !!profile?.on_leave;

  const visibleQ = useQuery({
    enabled: !!userId && !onLeave,
    queryKey: custodyVisibleQueryKey(userId, scopedBranchId),
    queryFn: async () => {
      try {
        return await fetchCustodyBoardVisible(scopedBranchId);
      } catch {
        return false;
      }
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!userId || !scopedBranchId) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: custodyVisibleQueryKey(userId, scopedBranchId) });
    const ch = supabase
      .channel(`shift-self-service-visible-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_shifts" },
        invalidate,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, invalidate)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "management_on_shift",
          filter: `branch_id=eq.${scopedBranchId}`,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, scopedBranchId, qc]);

  useEffect(() => {
    if (!userId) return;
    const invalidateOpen = () =>
      qc.invalidateQueries({ queryKey: ["my-open-break-nav", userId] });
    const ch = supabase
      .channel(`open-break-nav-rt-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "break_requests",
          filter: `user_id=eq.${userId}`,
        },
        invalidateOpen,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [userId, qc]);

  return {
    isVisible: !!profile && !onLeave && visibleQ.data === true,
    isLoading: !!profile && !onLeave && visibleQ.isLoading,
  };
}

const OPEN_BREAK_NAV_STATUSES = [
  "active",
  ...BREAK_PRE_ACTIVE_STATUSES,
  ...BREAK_PENDING_APPROVAL_STATUSES,
] as const;

/**
 * Sidebar / breaks page gate: on-shift (or not on leave) plus open break requests
 * so users can still reach /breaks to view or end an active break.
 */
export function useBreakSelfServiceNavVisible() {
  const shift = useShiftSelfServiceVisible();
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
      if (error) throw error;
      const open = new Set<string>(OPEN_BREAK_NAV_STATUSES);
      return (data ?? []).some((r) => open.has(r.status));
    },
    staleTime: 30_000,
  });

  return {
    isVisible: shift.isVisible || openQ.data === true,
    isLoading: shift.isLoading || (!shift.isVisible && openQ.isLoading),
    isOnShift: shift.isVisible,
  };
}
