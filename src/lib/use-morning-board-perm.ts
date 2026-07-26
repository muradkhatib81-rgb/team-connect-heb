import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { usePlatformOwnerStatus } from "@/lib/platform-owners.hooks";

/**
 * Whether the current user can manage (add/edit/delete/reorder) Morning
 * Board content for a given branch.
 *
 * Mirrors the DB rule (can_manage_morning_board_for_branch):
 *  - Platform Owner (main_admin / system_admin) → any branch
 *  - Users with `can_manage_morning_board` permission → only their OWN branch
 */
export function useCanManageMorningBoard(branchId: string | null) {
  const { data: profile } = useAuth();
  const uid = profile?.id;
  const platformStatus = usePlatformOwnerStatus();
  const isPlatformOwner = !!platformStatus.data?.isOwner;
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
  // BM / assistant: only with explicit can_manage_morning_board grant on own branch
  if (permQ.data && branchId && ownBranchId && branchId === ownBranchId) return true;
  return false;
}
