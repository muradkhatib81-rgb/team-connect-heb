import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { usePlatformOwnerStatus } from "@/lib/platform-owners.hooks";

/**
 * Whether the current user can manage (upload/replace/remove) the
 * Morning Board banner for a given branch.
 *
 * Authorization sources (mirrors DB RLS / has_manage_morning_board_perm):
 *  - Platform Owner (main_admin/system_admin) → any branch
 *  - Users with `can_manage_morning_board` permission → any branch
 *  - Branch manager → only their own branch
 */
export function useCanManageMorningBoard(branchId: string | null) {
  const { data: profile } = useAuth();
  const uid = profile?.id;
  const platformStatus = usePlatformOwnerStatus();
  const isPlatformOwner = !!platformStatus.data?.isOwner;
  const isBranchManager = !!profile?.roles.includes("branch_manager");
  const ownBranchId = (profile as any)?.branch_id ?? null;

  const permQ = useQuery({
    enabled: !!uid && !isPlatformOwner,
    queryKey: ["morning-board-perm", uid],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_morning_board")
        .eq("user_id", uid!)
        .maybeSingle();
      return !!(data as any)?.can_manage_morning_board;
    },
  });

  if (!profile) return false;
  if (isPlatformOwner) return true;
  if (permQ.data) return true;
  if (isBranchManager && branchId && ownBranchId && branchId === ownBranchId) return true;
  return false;
}
