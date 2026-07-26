import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useCustodyRealtime } from "@/lib/custody-workflow";
import { CustodyBoardCard } from "@/components/custody-board-card";

/** Live shift equipment board only — settings + daily log live in the sidebar. */
export function CustodyDashboardSection() {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  useCustodyRealtime(scopedBranchId, profile?.id, !!scopedBranchId);

  return <CustodyBoardCard />;
}
