import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, Radio, ChevronLeft, Clock, User } from "lucide-react";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  custodyDurationMinutes,
  custodyLogQueryKey,
  fetchCustodyDailyLog,
  fetchCustodyUserCaps,
  fmtCustodyDuration,
} from "@/lib/custody-workflow";

type CustodyActiveCardProps = {
  onOpenLog: () => void;
};

export function CustodyActiveCard({ onOpenLog }: CustodyActiveCardProps) {
  const [tick, setTick] = useState(() => Date.now());
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  const capsQ = useQuery({
    enabled: !!profile,
    queryKey: ["custody-caps", profile?.id],
    queryFn: () => fetchCustodyUserCaps(profile!.id),
  });

  const logQ = useQuery({
    enabled: !!scopedBranchId && !!capsQ.data?.canAccessCustodyLog,
    queryKey: custodyLogQueryKey(scopedBranchId),
    queryFn: () => fetchCustodyDailyLog(scopedBranchId!),
    staleTime: 0,
  });

  const activeRows = useMemo(
    () => (logQ.data ?? []).filter((r) => r.status === "active"),
    [logQ.data],
  );

  useEffect(() => {
    if (activeRows.length === 0) return;
    const id = window.setInterval(() => setTick(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, [activeRows.length]);

  if (!profile || capsQ.isLoading) return null;
  if (!capsQ.data?.canAccessCustodyLog || !scopedBranchId) return null;

  return (
    <button
      type="button"
      onClick={onOpenLog}
      className="w-full h-full text-right group min-h-[7.5rem]"
    >
      <Card className="p-5 h-full border-red-400/30 bg-gradient-to-br from-red-500/5 via-background to-background shadow-soft cursor-pointer transition-all hover:border-red-400/50 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <div className="size-9 rounded-lg bg-red-500/15 text-red-600 flex items-center justify-center shrink-0">
              <Radio className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold leading-tight">🔴 ציוד בשימוש כעת</h2>
              <p className="text-xs text-muted-foreground mt-0.5">לחץ ליומן מלא</p>
            </div>
          </div>
          <ChevronLeft className="size-5 text-red-600/70 opacity-60 group-hover:opacity-100 group-hover:-translate-x-0.5 transition-all shrink-0 mt-1" />
        </div>

        {logQ.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : activeRows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-3">אין ציוד בשימוש כרגע</p>
        ) : (
          <ul className="space-y-2">
            {activeRows.map((r) => {
              const mins = custodyDurationMinutes(r.checkedOutAt, tick);
              return (
                <li
                  key={r.id}
                  className="rounded-lg border border-red-400/25 bg-red-500/5 px-3 py-2.5 space-y-1"
                >
                  <div className="font-bold text-lg leading-tight">{r.itemName}</div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <User className="size-3.5 shrink-0" />
                      {r.userName}
                      {r.departmentName ? ` · ${r.departmentName}` : ""}
                    </span>
                    <span className="inline-flex items-center gap-1 font-medium text-red-700 dark:text-red-300">
                      <Clock className="size-3.5 shrink-0" />
                      {fmtCustodyDuration(mins)}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </button>
  );
}
