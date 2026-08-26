import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface JobTitleRow {
  id: string;
  name: string;
  excluded_from_headcount: boolean;
  can_request_break: boolean;
  can_punch_attendance?: boolean;
  sort_order: number;
}

export function useJobTitles() {
  return useQuery<JobTitleRow[]>({
    queryKey: ["job-titles"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("job_titles" as any)
        .select("id, name, excluded_from_headcount, can_request_break, can_punch_attendance, sort_order")
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });
      if (error) {
        // Column may not exist until migration is applied — fall back without it
        if (/can_punch_attendance|column/i.test(error.message)) {
          const { data: rows, error: err2 } = await supabase
            .from("job_titles" as any)
            .select("id, name, excluded_from_headcount, can_request_break, sort_order")
            .order("sort_order", { ascending: true })
            .order("name", { ascending: true });
          if (err2) throw err2;
          return ((rows ?? []) as unknown) as JobTitleRow[];
        }
        throw error;
      }
      return ((data ?? []) as unknown) as JobTitleRow[];
    },
  });
}
