import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ShieldCheck, LogIn, LogOut, Clock, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { getRoleLabel, type AppRole } from "@/lib/constants";
import i18n from "@/i18n";
import { toast } from "sonner";
import { useActiveBranch } from "@/lib/use-active-branch";
import {
  invalidateShiftVisibleQueries,
  shiftVisibleQueryKey,
} from "@/lib/shift-visible-rpc";
import { custodyQueryKey } from "@/lib/custody-workflow";
import { onManagementOnShiftChanges } from "@/lib/management-on-shift-realtime";
import { employeeNameInitial, formatEmployeeName } from "@/lib/employee-name";

type Row = {
  id: string;
  user_id: string;
  started_at: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: AppRole | null;
};

/** 24-hour time (HH:mm). */
function timeHM(iso: string) {
  return new Date(iso).toLocaleTimeString("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Full date in Hebrew locale (dd/MM/yyyy). */
function dateDMY(iso: string) {
  return new Date(iso).toLocaleDateString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function ManagementOnShiftCard() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const isEligible =
    !!profile &&
    (profile.roles.includes("branch_manager") ||
      profile.roles.includes("assistant_manager"));

  // Effective branch to scope the card to. Platform Owners get the branch
  // they explicitly selected in the switcher; everyone else is locked to
  // their own profile branch. This mirrors the Employee-of-the-Month
  // branch filtering behaviour.
  const scopedBranchId = activeBranchId ?? profile?.branch_id ?? null;

  const q = useQuery({
    enabled: !!profile && !!scopedBranchId,
    queryKey: ["management-on-shift", scopedBranchId],
    staleTime: 30_000,
    queryFn: async (): Promise<Row[]> => {
      // SECURITY DEFINER RPC — employees cannot read manager profiles via RLS,
      // but everyone in the branch should see who is on shift.
      const { data, error } = await supabase.rpc("get_management_on_shift");
      if (error) throw error;
      return ((data ?? []) as Row[]).map((row) => ({
        ...row,
        full_name: formatEmployeeName({ full_name: row.full_name }),
      }));
    },
  });

  useEffect(() => {
    if (!profile || !scopedBranchId) return;
    const invalidate = () =>
      qc.invalidateQueries({ queryKey: ["management-on-shift", scopedBranchId] });
    const ch = onManagementOnShiftChanges(
      supabase.channel(`mos-${profile.id}-${scopedBranchId}`),
      scopedBranchId,
      invalidate,
    ).subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, scopedBranchId, qc]);

  const myRow = useMemo(
    () => q.data?.find((r) => r.user_id === profile?.id),
    [q.data, profile?.id],
  );

  const startMut = useMutation({
    mutationFn: async () => {
      const branchId = activeBranchId ?? profile?.branch_id;
      if (!branchId) throw new Error(i18n.t("dashboard.noActiveBranch"));
      const { error } = await (supabase as any)
        .from("management_on_shift")
        .insert({ user_id: profile!.id, branch_id: branchId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(i18n.t("dashboard.markedOnShift"));
      const branchId = activeBranchId ?? profile?.branch_id ?? null;
      if (branchId) {
        qc.invalidateQueries({ queryKey: ["management-on-shift", branchId] });
      }
      if (profile?.id) {
        invalidateShiftVisibleQueries(qc, profile.id, branchId);
        qc.setQueryData(shiftVisibleQueryKey(profile.id, branchId), true);
      }
    },
    onError: (e: any) => toast.error(e.message ?? i18n.t("dashboard.shiftStatusError")),
  });

  const endMut = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any)
        .from("management_on_shift")
        .delete()
        .eq("user_id", profile!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(i18n.t("dashboard.markedShiftEnd"));
      const branchId = activeBranchId ?? profile?.branch_id ?? null;
      if (branchId) {
        qc.setQueryData<Row[]>(["management-on-shift", branchId], (prev) =>
          (prev ?? []).filter((r) => r.user_id !== profile!.id),
        );
        qc.invalidateQueries({ queryKey: ["management-on-shift", branchId] });
      }
      if (profile?.id) {
        invalidateShiftVisibleQueries(qc, profile.id, branchId);
        qc.setQueryData(shiftVisibleQueryKey(profile.id, branchId), false);
        qc.removeQueries({ queryKey: custodyQueryKey(branchId) });
      }
    },
    onError: (e: any) => toast.error(e.message ?? i18n.t("dashboard.shiftStatusError")),
  });

  const rows = q.data ?? [];

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background p-3 shadow-soft">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-tight">{i18n.t("dashboard.mgmtOnShift")}</h2>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {i18n.t("dashboard.mgmtOnShiftDesc")}
            </p>
          </div>
        </div>
        {isEligible && (
          <div className="flex items-center gap-2">
            {myRow ? (
              <Button
                variant="destructive"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={endMut.isPending}
                onClick={() => endMut.mutate()}
              >
                {endMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogOut className="size-3.5" />
                )}
                {i18n.t("dashboard.endMyShift")}
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs"
                disabled={startMut.isPending}
                onClick={() => startMut.mutate()}
              >
                {startMut.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LogIn className="size-3.5" />
                )}
                {i18n.t("dashboard.imOnShift")}
              </Button>
            )}
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-4 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/30 px-3 py-3">
          <ShieldCheck className="size-4 shrink-0 text-muted-foreground" />
          <p className="text-xs font-medium text-muted-foreground">
            {i18n.t("dashboard.noMgmtOnShift")}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="relative overflow-hidden rounded-lg border bg-card"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-red-500 to-red-600"
              />
              <div className="flex items-center gap-2.5 py-2 pl-3 pr-2.5">
                <div className="relative shrink-0">
                  <Avatar className="size-9 ring-1 ring-background">
                    <AvatarImage src={r.avatar_url ?? undefined} alt={r.full_name ?? ""} />
                    <AvatarFallback className="text-xs font-semibold">
                      {employeeNameInitial({ full_name: r.full_name })}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    aria-label={i18n.t("dashboard.onShiftAria")}
                    className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-emerald-500 ring-2 ring-card"
                  />
                </div>
                <div className="min-w-0 flex-1 text-right">
                  <p className="truncate text-sm font-bold leading-tight text-foreground">
                    {r.full_name}
                  </p>
                  <p className="mt-0.5 truncate text-xs font-semibold text-red-600 dark:text-red-400">
                    {r.job_title ?? (r.role ? getRoleLabel(r.role) : i18n.t("dashboard.management"))}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
                    <span className="inline-flex items-center gap-0.5">
                      <CalendarDays className="size-2.5" />
                      {dateDMY(r.started_at)}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Clock className="size-2.5" />
                      {timeHM(r.started_at)}
                    </span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
