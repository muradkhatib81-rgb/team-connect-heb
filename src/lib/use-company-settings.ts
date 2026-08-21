import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getActiveBranchScope } from "@/integrations/supabase/branch-scope";
import { useActiveBranch } from "@/lib/use-active-branch";
import { BRANCH_NAME } from "@/lib/constants";
import { mergeCompanyRowWithPeriodExtra } from "@/lib/schedule-period-settings";

export type ScheduleType = "weekly" | "monthly" | "custom";

export interface CompanySettings {
  id: string;
  company_name: string;
  logo_url: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  primary_color: string | null;
  schedule_type: ScheduleType;
  week_start_dow: number;
  week_end_dow: number;
  monthly_working_dows: number[];
}

const DEFAULTS: CompanySettings = {
  id: "",
  company_name: BRANCH_NAME, // intentionally empty — no hardcoded brand.
  logo_url: null,
  address: null,
  phone: null,
  email: null,
  primary_color: null,
  schedule_type: "weekly",
  week_start_dow: 0,
  week_end_dow: 6,
  monthly_working_dows: [0, 1, 2, 3, 4, 5, 6],
};

async function fetchCompanySettings(opts: {
  /** When true (auth / public), allow reading the oldest active row without a branch scope. */
  allowUnscoped: boolean;
}): Promise<CompanySettings> {
  const scope = getActiveBranchScope();
  // Inside the authenticated shell, never leak the legacy/default store's
  // branding when Branch Mode is off — that row's company_name historically
  // matched a branch name, which looked like "company name = branch name".
  if (!scope && !opts.allowUnscoped) {
    return DEFAULTS;
  }

  const { data, error } = await supabase
    .from("company_settings" as any)
    .select(
      "id, company_name, logo_url, address, phone, email, primary_color, schedule_type, week_start_dow, week_end_dow, monthly_working_dows, extra",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) {
    const { data: fallback } = await supabase
      .from("company_settings" as any)
      .select("id, company_name, logo_url, address, phone, email, primary_color, schedule_type, extra")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!fallback) return DEFAULTS;
    const merged = mergeCompanyRowWithPeriodExtra(fallback as Record<string, unknown>);
    return {
      ...DEFAULTS,
      ...(fallback as object),
      schedule_type: merged.schedule_type,
      week_start_dow: merged.week_start_dow,
      week_end_dow: merged.week_end_dow,
      monthly_working_dows: merged.monthly_working_dows,
    };
  }
  if (!data) return DEFAULTS;
  const row = data as Record<string, unknown>;
  const merged = mergeCompanyRowWithPeriodExtra(row);
  return {
    ...DEFAULTS,
    ...row,
    schedule_type: merged.schedule_type,
    week_start_dow: merged.week_start_dow,
    week_end_dow: merged.week_end_dow,
    monthly_working_dows: merged.monthly_working_dows,
  };
}

export function useCompanySettings(opts?: { allowUnscoped?: boolean }) {
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const allowUnscoped = opts?.allowUnscoped ?? false;
  const query = useQuery({
    queryKey: ["company-settings", activeBranchId ?? "none", allowUnscoped],
    queryFn: () => fetchCompanySettings({ allowUnscoped }),
    staleTime: 1000 * 60,
    initialData: DEFAULTS,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`company-settings-rt-${activeBranchId ?? "none"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "company_settings" },
        () => {
          qc.invalidateQueries({ queryKey: ["company-settings"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, activeBranchId]);

  return query;
}
