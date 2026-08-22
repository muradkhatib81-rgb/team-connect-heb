import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/lib/use-active-branch";
import type { BranchPeriodConfig } from "@/lib/schedule-period-config";
import { fetchSchedulePeriodConfig } from "@/lib/schedule-period-settings";

export function useSchedulePeriodConfig() {
  const { activeBranchId } = useActiveBranch();
  return useQuery({
    queryKey: ["schedule-period-config", activeBranchId ?? "none"],
    queryFn: () => fetchSchedulePeriodConfig(supabase, activeBranchId),
    staleTime: 30_000,
  });
}
