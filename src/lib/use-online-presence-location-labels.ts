import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { PresenceLocationLabels } from "@/lib/online-presence";

export function useOnlinePresenceLocationLabels(branchIds: string[]) {
  const uniqueIds = [...new Set(branchIds.filter(Boolean))].sort();

  return useQuery({
    queryKey: ["online-presence-location-labels", uniqueIds],
    enabled: uniqueIds.length > 0,
    queryFn: async (): Promise<PresenceLocationLabels> => {
      const branchNames = new Map<string, string>();
      const companyByBranch = new Map<string, { companyId: string; companyName: string }>();

      const { data: branches, error: branchErr } = await supabase
        .from("branches")
        .select("id, name")
        .in("id", uniqueIds);
      if (branchErr) throw branchErr;
      for (const row of branches ?? []) {
        branchNames.set(row.id, row.name);
      }

      const { data: assignments, error: assignErr } = await supabase
        .from("company_branch_assignments" as never)
        .select("source_branch_id, company_id, companies(name)")
        .in("source_branch_id", uniqueIds)
        .is("deleted_at", null);
      if (assignErr) throw assignErr;

      for (const row of (assignments ?? []) as Array<{
        source_branch_id: string;
        company_id: string;
        companies: { name: string } | null;
      }>) {
        companyByBranch.set(row.source_branch_id, {
          companyId: row.company_id,
          companyName: row.companies?.name ?? "",
        });
      }

      return { branchNames, companyByBranch };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
