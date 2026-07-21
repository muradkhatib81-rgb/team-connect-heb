import { useEffect, useMemo } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ShieldCheck, LogIn, LogOut, Clock, CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { toast } from "sonner";
import { useActiveBranch } from "@/lib/use-active-branch";
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
    const ch = supabase
      .channel(`mos-${profile.id}-${scopedBranchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "management_on_shift",
          filter: `branch_id=eq.${scopedBranchId}`,
        },
        () => qc.invalidateQueries({ queryKey: ["management-on-shift", scopedBranchId] }),
      )
      .subscribe();
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
      if (!branchId) throw new Error("לא נמצא סניף פעיל");
      const { error } = await (supabase as any)
        .from("management_on_shift")
        .insert({ user_id: profile!.id, branch_id: branchId });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("סומנת כנמצא במשמרת");
      qc.invalidateQueries({ queryKey: ["management-on-shift"] });
    },
    onError: (e: any) => toast.error(e.message ?? "שגיאה בעדכון סטטוס משמרת"),
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
      toast.success("סימנת סיום משמרת");
      qc.invalidateQueries({ queryKey: ["management-on-shift"] });
    },
    onError: (e: any) => toast.error(e.message ?? "שגיאה בעדכון סטטוס משמרת"),
  });

  const rows = q.data ?? [];

  return (
    <Card className="p-5 border-primary/20 bg-gradient-to-br from-primary/5 via-background to-background shadow-soft">
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="size-9 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="text-base font-bold leading-tight">👔 הנהלה במשמרת</h2>
            <p className="text-xs text-muted-foreground">
              מנהלי הסניף שנמצאים כרגע במשמרת
            </p>
          </div>
        </div>
        {isEligible && (
          <div className="flex items-center gap-2">
            {myRow ? (
              <Button
                variant="destructive"
                size="sm"
                className="gap-2"
                disabled={endMut.isPending}
                onClick={() => endMut.mutate()}
              >
                {endMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogOut className="size-4" />
                )}
                סיימתי משמרת
              </Button>
            ) : (
              <Button
                size="sm"
                className="gap-2"
                disabled={startMut.isPending}
                onClick={() => startMut.mutate()}
              >
                {startMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogIn className="size-4" />
                )}
                אני במשמרת
              </Button>
            )}
          </div>
        )}
      </div>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-10 border border-dashed rounded-xl bg-muted/30">
          <div className="size-11 rounded-full bg-muted flex items-center justify-center">
            <ShieldCheck className="size-5 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">
            אין הנהלה במשמרת כרגע
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="relative overflow-hidden rounded-xl border bg-card shadow-sm hover:shadow-md transition-shadow"
            >
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-red-500 to-red-600"
              />
              <div className="flex flex-col items-center text-center gap-3 p-5 pl-6">
                <div className="relative shrink-0">
                  <Avatar className="size-16 ring-2 ring-background shadow-md">
                    <AvatarImage src={r.avatar_url ?? undefined} alt={r.full_name ?? ""} />
                    <AvatarFallback className="text-lg font-semibold">
                      {employeeNameInitial({ full_name: r.full_name })}
                    </AvatarFallback>
                  </Avatar>
                  <span
                    aria-label="במשמרת"
                    className="absolute -bottom-0.5 -right-0.5 size-3.5 rounded-full bg-emerald-500 ring-2 ring-card"
                  >
                    <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
                  </span>
                </div>
                <div className="min-w-0 w-full">
                  <p className="text-xl sm:text-2xl font-extrabold leading-tight tracking-tight text-foreground break-words">
                    {r.full_name}
                  </p>
                  <p className="text-sm font-semibold text-red-600 dark:text-red-400 mt-1">
                    {r.job_title ?? (r.role ? (ROLE_LABELS[r.role] ?? r.role) : "הנהלה")}
                  </p>
                  <div className="flex items-center justify-center gap-1 mt-2 text-[11px] text-muted-foreground">
                    <CalendarDays className="size-3" />
                    <span>{dateDMY(r.started_at)}</span>
                  </div>
                  <div className="flex items-center justify-center gap-1 mt-0.5 text-[11px] text-muted-foreground">
                    <Clock className="size-3" />
                    <span>שעת התחלה: {timeHM(r.started_at)}</span>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
