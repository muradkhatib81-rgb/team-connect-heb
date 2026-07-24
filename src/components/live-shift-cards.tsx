import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useShiftDefinitions } from "@/lib/use-shift-definitions";
import { formatHHMM, usePlatformNow } from "@/lib/platform-time";
import { getScheduleWeek } from "@/lib/schedule-week";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useAuth } from "@/lib/use-auth";
import {
  resolveScheduleManagerCaps,
  scheduleScopeNeedsLoadedPermissions,
} from "@/lib/schedule-manager-caps";
import { isBranchLevelScheduleViewer } from "@/lib/schedule-visibility";

type TodayRow = {
  employee_id: string;
  shift: string;
  start_time: string | null;
  end_time: string | null;
  schedule_id: string;
};

type EmployeeInfo = {
  id: string;
  full_name: string;
  job_title: string | null;
};

type DisplayEmployee = EmployeeInfo & { start: string | null; end: string | null };

/**
 * Dynamic shift summary cards for the Main Dashboard (branch-level viewers).
 *
 * - One card per active shift definition (ordered by sort_order).
 * - Counts = employees assigned to that shift **today** in published schedules
 *   for the current schedule week (בוקר / ערב / חופש — including חופש with no hours).
 * - Realtime on schedule_shifts / schedules / shift_definitions.
 */
export function LiveShiftCardsSection() {
  const qc = useQueryClient();
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const { dateISO } = usePlatformNow();

  const needsLoadedPerms = profile
    ? scheduleScopeNeedsLoadedPermissions(profile.roles)
    : false;

  const permsQ = useQuery({
    enabled: !!profile?.id,
    queryKey: ["my-perms", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select(
          "can_create_schedule, can_approve_schedule, can_publish_schedule, can_manage_schedule",
        )
        .eq("user_id", profile!.id)
        .maybeSingle();
      return data ?? {};
    },
  });

  const permsReady = !needsLoadedPerms || !permsQ.isLoading;
  const scheduleCaps = useMemo(
    () =>
      resolveScheduleManagerCaps(
        profile?.roles ?? [],
        permsReady ? permsQ.data : undefined,
      ),
    [profile?.roles, permsQ.data, permsReady],
  );

  const canView = useMemo(() => {
    if (!profile) return false;
    return isBranchLevelScheduleViewer({
      userId: profile.id,
      isMainAdmin: scheduleCaps.isMainAdmin,
      isBranchMgr: scheduleCaps.isBranchMgr,
      isDeptMgr: scheduleCaps.isDeptMgr,
      canCreate: scheduleCaps.canCreate,
      canApprove: scheduleCaps.canApprove,
      canPublishDirect: scheduleCaps.canPublishDirect,
      departmentId: profile.department_id,
    });
  }, [profile, scheduleCaps]);

  const weekStart = useMemo(
    () => getScheduleWeek(new Date(`${dateISO}T12:00:00Z`)).weekStart,
    [dateISO],
  );

  // Today's published assignments for the current schedule week.
  const rowsQ = useQuery<TodayRow[]>({
    enabled: canView && permsReady && !!dateISO,
    queryKey: ["dashboard-shift-cards", "today", dateISO, weekStart, activeBranchId ?? "all"],
    queryFn: async () => {
      let schedQ = supabase
        .from("schedules")
        .select("id")
        .eq("status", "approved")
        .not("published_at", "is", null)
        .eq("week_start", weekStart);
      if (activeBranchId) schedQ = schedQ.eq("branch_id", activeBranchId);
      const { data: scheds, error: schedErr } = await schedQ;
      if (schedErr) throw schedErr;
      const ids = (scheds ?? []).map((s: any) => s.id as string);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("schedule_shifts")
        .select("employee_id, shift, start_time, end_time, schedule_id")
        .eq("day_date", dateISO)
        .in("schedule_id", ids);
      if (error) throw error;
      return (data ?? []) as TodayRow[];
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const empIds = useMemo(
    () => Array.from(new Set((rowsQ.data ?? []).map((r) => r.employee_id))),
    [rowsQ.data],
  );

  const empsQ = useQuery<EmployeeInfo[]>({
    enabled: empIds.length > 0,
    queryKey: ["dashboard-shift-cards", "emps", empIds.sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, job_title")
        .in("id", empIds);
      if (error) throw error;
      return (data ?? []) as EmployeeInfo[];
    },
    staleTime: 60_000,
  });

  // Realtime: keep the dashboard live without polling.
  useEffect(() => {
    const ch = supabase
      .channel("dashboard-shift-cards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_shifts" },
        () => qc.invalidateQueries({ queryKey: ["dashboard-shift-cards", "today"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedules" },
        () => qc.invalidateQueries({ queryKey: ["dashboard-shift-cards", "today"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_notifications" },
        () => qc.invalidateQueries({ queryKey: ["dashboard-shift-cards", "today"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_definitions" },
        () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // Group employees by shift code — all assignments today (deduped per employee).
  const { byShift, empMap } = useMemo(() => {
    const empMap = new Map<string, EmployeeInfo>();
    for (const e of empsQ.data ?? []) empMap.set(e.id, e);
    const byShift = new Map<string, DisplayEmployee[]>();
    const seenByShift = new Map<string, Set<string>>();
    for (const def of shiftDefsQ.list) {
      byShift.set(def.code, []);
      seenByShift.set(def.code, new Set());
    }
    for (const r of rowsQ.data ?? []) {
      const def = shiftDefsQ.map.get(r.shift);
      if (!def || !def.is_active) continue;
      const seen = seenByShift.get(r.shift);
      if (!seen || seen.has(r.employee_id)) continue;
      seen.add(r.employee_id);
      const start = r.start_time ?? def.start_time ?? null;
      const end = r.end_time ?? def.end_time ?? null;
      const info = empMap.get(r.employee_id);
      const list = byShift.get(r.shift) ?? [];
      list.push({
        id: r.employee_id,
        full_name: info?.full_name ?? "עובד",
        job_title: info?.job_title ?? null,
        start: start ? formatHHMM(start) : null,
        end: end ? formatHHMM(end) : null,
      });
      byShift.set(r.shift, list);
    }
    for (const list of byShift.values()) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
    }
    return { byShift, empMap };
  }, [rowsQ.data, empsQ.data, shiftDefsQ.list, shiftDefsQ.map]);

  void empMap;

  const [openShift, setOpenShift] = useState<string | null>(null);

  if (!canView || !permsReady) return null;
  if (shiftDefsQ.list.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">משמרות היום</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shiftDefsQ.list.map((def) => {
          const list = byShift.get(def.code) ?? [];
          const count = list.length;
          const countLabel =
            count === 0 ? "0 עובדים" : count === 1 ? "עובד אחד" : `${count} עובדים`;
          const defaultRange =
            def.start_time && def.end_time
              ? `${String(def.start_time).slice(0, 5)}–${String(def.end_time).slice(0, 5)}`
              : "";
          return (
            <ShiftCard
              key={def.id}
              name={def.name}
              color={def.color}
              count={count}
              countLabel={countLabel}
              defaultRange={defaultRange}
              onOpen={() => setOpenShift(def.code)}
            />
          );
        })}
      </div>

      <Dialog open={!!openShift} onOpenChange={(o) => !o && setOpenShift(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {openShift ? shiftDefsQ.map.get(openShift)?.name ?? "משמרת" : "משמרת"}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const list = openShift ? byShift.get(openShift) ?? [] : [];
            if (list.length === 0) {
              return (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  אין עובדים במשמרת זו היום
                </p>
              );
            }
            return (
              <ul className="divide-y max-h-[60vh] overflow-y-auto">
                {list.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.full_name}</div>
                      {e.job_title && (
                        <div className="text-xs text-muted-foreground truncate">
                          {e.job_title}
                        </div>
                      )}
                    </div>
                    {e.start && e.end && (
                      <div className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                        {e.start}–{e.end}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const ShiftCard = ({
  name,
  color,
  count,
  countLabel,
  defaultRange,
  onOpen,
}: {
  name: string;
  color: string;
  count: number;
  countLabel: string;
  defaultRange: string;
  onOpen: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-right rounded-xl border bg-card p-4 hover:shadow-md hover:-translate-y-0.5 transition focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={`${name}: ${countLabel}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="font-semibold truncate">{name}</span>
          </div>
          {defaultRange && (
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums" dir="ltr">
              {defaultRange}
            </div>
          )}
        </div>
        <Users className="size-4 text-muted-foreground shrink-0" />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {count}
        </span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
    </button>
  );
};
