import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { startOnlinePresenceTracking, type OnlinePresenceTrackInput } from "@/lib/online-presence-hub";

export function useOnlinePresenceTracker(input: OnlinePresenceTrackInput | null) {
  useEffect(() => {
    if (!input?.userId) return;
    return startOnlinePresenceTracking(input);
  }, [
    input?.userId,
    input?.fullName,
    input?.branchId,
    input?.companyId,
    input?.role,
  ]);
}

/** Resolve company_id for the user's active branch (presence metadata). */
export function useBranchCompanyId(branchId: string | null | undefined) {
  return useQuery({
    enabled: !!branchId,
    queryKey: ["branch-company-id", branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("company_id")
        .eq("id", branchId!)
        .maybeSingle();
      if (error) throw error;
      return data?.company_id ?? null;
    },
    staleTime: 120_000,
  });
}
