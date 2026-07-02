import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ShieldCheck, LogIn, LogOut, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { ROLE_LABELS, type AppRole } from "@/lib/constants";
import { toast } from "sonner";
import { useActiveBranch } from "@/lib/use-active-branch";

type Row = {
  id: string;
  user_id: string;
  started_at: string;
  full_name: string | null;
  avatar_url: string | null;
  job_title: string | null;
  role: AppRole | null;
};

function timeHM(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" });
}

export function ManagementOnShiftCard() {
  const { data: profile } = useAuth();
  const qc = useQueryClient();
  const { activeBranchId } = useActiveBranch();
  const isEligible =
    !!profile &&
    (profile.roles.includes("branch_manager") ||
      profile.roles.includes("assistant_manager"));

  const q = useQuery({
    enabled: !!profile,
    queryKey: ["management-on-shift", activeBranchId],
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await (supabase as any).rpc("get_management_on_shift");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id,
        user_id: r.user_id,
        started_at: r.started_at,
        full_name: r.full_name ?? null,
        avatar_url: r.avatar_url ?? null,
        job_title: r.job_title ?? null,
        role: (r.role as AppRole) ?? null,
      }));
    },
  });

  useEffect(() => {
    if (!profile) return;
    const ch = supabase
      .channel(`mos-${profile.id}-${activeBranchId ?? "own"}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "management_on_shift" },
        () => qc.invalidateQueries({ queryKey: ["management-on-shift"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [profile?.id, activeBranchId, qc]);

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
        <div className="flex items-center justify-center py-6 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-6 border border-dashed rounded-lg">
          אין הנהלה במשמרת כרגע
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-3 p-3 rounded-lg bg-card border"
            >
              <Avatar className="size-11">
                <AvatarImage src={r.avatar_url ?? undefined} alt={r.full_name ?? ""} />
                <AvatarFallback>{r.full_name?.charAt(0) ?? "?"}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-sm truncate">
                  {r.full_name ?? "—"}
                </p>
                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  {r.role && (
                    <Badge variant="secondary" className="rounded-full text-[10px] px-2 py-0">
                      {ROLE_LABELS[r.role] ?? r.role}
                    </Badge>
                  )}
                  {r.job_title && (
                    <span className="text-[11px] text-muted-foreground truncate">
                      {r.job_title}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                  <Clock className="size-3" />
                  התחיל/ה משמרת בשעה {timeHM(r.started_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
