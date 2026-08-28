import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  startOnlinePresenceTracking,
  updateOnlinePresenceTrackInput,
  type OnlinePresenceTrackInput,
} from "@/lib/online-presence-hub";

export function useOnlinePresenceTracker(input: OnlinePresenceTrackInput | null) {
  useEffect(() => {
    if (!input?.userId) return;
    return startOnlinePresenceTracking(input);
  }, [input?.userId]);

  useEffect(() => {
    if (!input?.userId) return;
    updateOnlinePresenceTrackInput(input);
  }, [
    input?.userId,
    input?.fullName,
    input?.branchId,
    input?.companyId,
    input?.branchName,
    input?.companyName,
    input?.role,
  ]);
}

export type BranchPresenceContext = {
  companyId: string | null;
  branchName: string | null;
  companyName: string | null;
};

/** Branch + company metadata for presence payloads (real branch id → platform company). */
export function useBranchPresenceContext(branchId: string | null | undefined) {
  return useQuery({
    enabled: !!branchId,
    queryKey: ["branch-presence-context", branchId],
    queryFn: async (): Promise<BranchPresenceContext> => {
      const { data: branch, error: branchErr } = await supabase
        .from("branches")
        .select("id, name")
        .eq("id", branchId!)
        .maybeSingle();
      if (branchErr) throw branchErr;

      const { data: assignment, error: assignErr } = await supabase
        .from("company_branch_assignments" as never)
        .select("company_id, companies(name)")
        .eq("source_branch_id", branchId!)
        .is("deleted_at", null)
        .maybeSingle();
      if (assignErr && !/company_branch_assignments|does not exist|PGRST/i.test(assignErr.message)) {
        throw assignErr;
      }

      const row = assignment as { company_id: string; companies: { name: string } | null } | null;

      return {
        companyId: row?.company_id ?? null,
        branchName: branch?.name ?? null,
        companyName: row?.companies?.name ?? null,
      };
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
}

/** @deprecated Use useBranchPresenceContext */
export function useBranchCompanyId(branchId: string | null | undefined) {
  const q = useBranchPresenceContext(branchId);
  return {
    ...q,
    data: q.data?.companyId ?? null,
  };
}
