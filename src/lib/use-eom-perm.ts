import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";

/** Returns whether the current user can manage Employee of the Month. */
export function useCanManageEom() {
  const { data: profile } = useAuth();
  const uid = profile?.id;
  const isMainAdmin = !!profile?.roles.includes("main_admin");

  const q = useQuery({
    enabled: !!uid && !isMainAdmin,
    queryKey: ["eom-perm", uid],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_employee_of_month")
        .eq("user_id", uid!)
        .maybeSingle();
      return !!(data as any)?.can_manage_employee_of_month;
    },
  });

  return isMainAdmin ? true : !!q.data;
}
