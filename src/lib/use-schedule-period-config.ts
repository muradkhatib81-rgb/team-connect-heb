import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  branchPeriodConfigFromSettings,
  DEFAULT_PERIOD_CONFIG,
  type BranchPeriodConfig,
} from "@/lib/schedule-period-config";
import { mergeCompanyRowWithPeriodExtra } from "@/lib/schedule-period-settings";

function configFromRpcPayload(raw: unknown): BranchPeriodConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.schedule_type == null && row.week_start_dow == null) return null;
  return branchPeriodConfigFromSettings(row);
}

async function fetchSchedulePeriodConfig(activeBranchId: string | null): Promise<BranchPeriodConfig> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("get_schedule_period_settings" as any, {
    p_branch_id: activeBranchId,
  });
  if (!rpcErr) {
    const fromRpc = configFromRpcPayload(rpcData);
    if (fromRpc) return fromRpc;
  }

  let query = supabase
    .from("company_settings" as any)
    .select("schedule_type, week_start_dow, week_end_dow, monthly_working_dows, extra, branch_id")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (activeBranchId) {
    query = query.eq("branch_id", activeBranchId);
  }

  const { data: scoped, error: scopedErr } = await query.limit(1).maybeSingle();
  if (!scopedErr && scoped) {
    return mergeCompanyRowWithPeriodExtra(scoped as Record<string, unknown>);
  }

  const { data: fallback } = await supabase
    .from("company_settings" as any)
    .select("schedule_type, week_start_dow, week_end_dow, monthly_working_dows, extra")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallback) {
    return mergeCompanyRowWithPeriodExtra(fallback as Record<string, unknown>);
  }

  return DEFAULT_PERIOD_CONFIG;
}

export function useSchedulePeriodConfig() {
  const { activeBranchId } = useActiveBranch();
  return useQuery({
    queryKey: ["schedule-period-config", activeBranchId ?? "none"],
    queryFn: () => fetchSchedulePeriodConfig(activeBranchId),
    staleTime: 30_000,
  });
}
