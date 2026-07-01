import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BRANCH_NAME } from "@/lib/constants";

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
};

async function fetchCompanySettings(): Promise<CompanySettings> {
  const { data } = await supabase
    .from("company_settings" as any)
    .select("id, company_name, logo_url, address, phone, email, primary_color, schedule_type")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return DEFAULTS;
  const row = data as any;
  return {
    ...DEFAULTS,
    ...row,
    schedule_type: (row.schedule_type as ScheduleType) ?? "weekly",
  };
}

export function useCompanySettings() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["company-settings"],
    queryFn: fetchCompanySettings,
    staleTime: 1000 * 60,
    initialData: DEFAULTS,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`company-settings-rt-${Date.now()}-${Math.random().toString(36).slice(2)}`)
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
  }, [qc]);

  return query;
}
