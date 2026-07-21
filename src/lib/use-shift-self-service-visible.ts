import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  custodyVisibleQueryKey,
  fetchCustodyBoardVisible,
} from "@/lib/custody-workflow";

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
    queryFn: () => fetchCustodyBoardVisible(scopedBranchId),
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

  return {
    isVisible: !!profile && !onLeave && visibleQ.data === true,
    isLoading: !!profile && !onLeave && visibleQ.isLoading,
  };
}
