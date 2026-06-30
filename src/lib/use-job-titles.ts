import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JobTitleRow {
  id: string;
  name: string;
  excluded_from_headcount: boolean;
  sort_order: number;
}

export function useJobTitles() {
  return useQuery<JobTitleRow[]>({
    queryKey: ["job-titles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_titles" as any)
        .select("id, name, excluded_from_headcount, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return ((data ?? []) as unknown) as JobTitleRow[];
    },
  });
}
