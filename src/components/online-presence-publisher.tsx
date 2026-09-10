import { useMemo } from "react";
import type { AuthProfile } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useBranchPresenceContext, useOnlinePresenceTracker } from "@/lib/use-online-presence-tracker";
import { highestRole, isPlatformOwner } from "@/lib/constants";

export function OnlinePresencePublisher({ profile }: { profile: AuthProfile }) {
  const { activeBranchId, activeBranch } = useActiveBranch();
  const owner = isPlatformOwner(profile.roles);
  // Platform owners use Branch Mode for navigation only — do not treat that
  // selection as employment location in online presence.
  const branchId = owner ? null : (activeBranchId ?? profile.branch_id);
  const contextQ = useBranchPresenceContext(branchId);
  const role = useMemo(() => highestRole(profile.roles) ?? "employee", [profile.roles]);

  useOnlinePresenceTracker(
    profile.is_active
      ? {
          userId: profile.id,
          fullName: profile.full_name,
          branchId,
          companyId: owner ? null : (contextQ.data?.companyId ?? null),
          branchName: owner
            ? null
            : (activeBranch?.name ?? contextQ.data?.branchName ?? null),
          companyName: owner ? null : (contextQ.data?.companyName ?? null),
          role,
        }
      : null,
  );

  return null;
}
