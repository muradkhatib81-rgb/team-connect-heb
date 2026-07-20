import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { fetchCustodyUserCaps, useCustodyRealtime } from "@/lib/custody-workflow";
import { CustodyBoardCard } from "@/components/custody-board-card";
import { CustodyActiveCard } from "@/components/custody-active-card";
import { CustodyLogCard } from "@/components/custody-log-card";

export function CustodyDashboardSection() {
  const [logOpen, setLogOpen] = useState(false);
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  const capsQ = useQuery({
    enabled: !!profile,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
  });

  const showLogSection = !!scopedBranchId && !!capsQ.data?.canAccessCustodyLog;

  useCustodyRealtime(scopedBranchId, profile?.id, !!scopedBranchId);

  return (
    <div className="space-y-3">
      <div
        className={
          showLogSection
            ? "grid grid-cols-1 lg:grid-cols-2 gap-3 items-stretch"
            : "grid grid-cols-1 gap-3"
        }
      >
        <CustodyBoardCard />
        {showLogSection && <CustodyActiveCard onOpenLog={() => setLogOpen(true)} />}
      </div>
      {showLogSection && <CustodyLogCard open={logOpen} onOpenChange={setLogOpen} />}
    </div>
  );
}
