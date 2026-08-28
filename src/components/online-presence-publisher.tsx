import { useMemo } from "react";
import type { AuthProfile } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useBranchPresenceContext, useOnlinePresenceTracker } from "@/lib/use-online-presence-tracker";
import { highestRole } from "@/lib/constants";

export function OnlinePresencePublisher({ profile }: { profile: AuthProfile }) {
  const { activeBranchId, activeBranch } = useActiveBranch();
  const branchId = activeBranchId ?? profile.branch_id;
  const contextQ = useBranchPresenceContext(branchId);
  const role = useMemo(() => highestRole(profile.roles) ?? "employee", [profile.roles]);

  useOnlinePresenceTracker(
    profile.is_active
      ? {
          userId: profile.id,
          fullName: profile.full_name,
          branchId,
          companyId: contextQ.data?.companyId ?? null,
          branchName: activeBranch?.name ?? contextQ.data?.branchName ?? null,
          companyName: contextQ.data?.companyName ?? null,
          role,
        }
      : null,
  );

  return null;
}
