import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { getScheduleWeek, formatScheduleDayHe } from "@/lib/schedule-week";
import { formatShiftTimeRange } from "@/lib/shift-hours";
import { useActiveBranch } from "@/lib/use-active-branch";
import { useAuth } from "@/lib/use-auth";
import i18n from "@/i18n";
import {
  resolveScheduleManagerCaps,
  scheduleScopeNeedsLoadedPermissions,
} from "@/lib/schedule-manager-caps";
import { isBranchLevelScheduleViewer } from "@/lib/schedule-visibility";
import {
  countLeaveDays,
  formatLeaveDateRange,
  isEmployeeOnLeaveOnDate,
  leaveOffLabel,
} from "@/lib/employee-leave";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";

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
  department_name: string | null;
  /** Job-title flag: appear in app, but never in schedule headcount numbers/lists. */
  excluded_from_headcount: boolean;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_code: string | null;
};

type DisplayEmployee = EmployeeInfo & { start: string | null; end: string | null };

const OFF_SHIFT_CODE = "off";

/**
 * Dynamic shift summary cards for the Main Dashboard (branch-level viewers).
 *
 * - One card per active shift definition (ordered by sort_order).
 * - Working shifts (בוקר / ערב / …) = published schedule assignments for today.
 * - חופש (off) = anyone on leave today from any source that updates the profile
 *   leave window (manual employee-file leave, approved leave request, or
 *   schedule marking via apply_leave_to_schedule_shifts), plus anyone marked
 *   חופש in a published schedule. They stay counted until the leave window
 *   ends or is cleared.
 * - Honors excluded_from_headcount (תפקיד "לא נכלל במצבת").
 */
export function LiveShiftCardsSection({ dateISO: dateISOProp }: { dateISO?: string }) {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const { dateISO: todayISO } = usePlatformNow();
  const dateISO = dateISOProp ?? todayISO;
  const isToday = dateISO === todayISO;

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
          "can_view_schedule, can_create_schedule, can_edit_schedule, can_approve_schedule, can_publish_schedule, can_manage_schedule",
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
      canView: scheduleCaps.canView,
      canCreate: scheduleCaps.canCreate,
      canEdit: scheduleCaps.canEdit,
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
    staleTime: 30_000,
  });

  // Branch staff + leave windows — same source as the dashboard "בחופשה" tile.
  // Needed so חופש counts manual / approved leave even when no schedule is published.
  const leaveEmpsQ = useQuery<EmployeeInfo[]>({
    enabled: canView && permsReady && !!dateISO,
    queryKey: ["dashboard-shift-cards", "leave-emps", dateISO, activeBranchId ?? "all"],
    queryFn: async () => {
      // Prefer server filter: flagged on_leave OR leave window covering today.
      let q = supabase
        .from("profiles")
        .select(
          "id, full_name, job_title, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code, department_id, branch_id, departments(name)",
        )
        .or(
          `on_leave.eq.true,and(leave_start_date.lte.${dateISO},leave_end_date.gte.${dateISO})`,
        );
      if (activeBranchId) q = q.eq("branch_id", activeBranchId);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as any[])
        .filter((row) => !isNonEmployeeIdentity(row))
        .filter((row) =>
          isEmployeeOnLeaveOnDate(
            {
              on_leave: !!row.on_leave,
              leave_start_date: row.leave_start_date,
              leave_end_date: row.leave_end_date,
            },
            dateISO,
          ),
        )
        .map((row) => ({
          id: row.id as string,
          full_name: row.full_name as string,
          job_title: (row.job_title as string | null) ?? null,
          department_name:
            (row.departments?.name as string | null | undefined) ?? null,
          excluded_from_headcount: !!row.excluded_from_headcount,
          on_leave: !!row.on_leave,
          leave_start_date: (row.leave_start_date as string | null) ?? null,
          leave_end_date: (row.leave_end_date as string | null) ?? null,
          leave_type_code: (row.leave_type_code as string | null) ?? null,
        }));
    },
    staleTime: 30_000,
  });

  const scheduleEmpIds = useMemo(
    () => Array.from(new Set((rowsQ.data ?? []).map((r) => r.employee_id))),
    [rowsQ.data],
  );

  // Profiles for schedule assignees who are not already in the leave query result
  // (working shifts still need names / headcount flags).
  const scheduleOnlyIds = useMemo(() => {
    const onLeave = new Set((leaveEmpsQ.data ?? []).map((e) => e.id));
    return scheduleEmpIds.filter((id) => !onLeave.has(id));
  }, [scheduleEmpIds, leaveEmpsQ.data]);

  const scheduleEmpsQ = useQuery<EmployeeInfo[]>({
    enabled: scheduleOnlyIds.length > 0,
    queryKey: ["dashboard-shift-cards", "emps", scheduleOnlyIds.slice().sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, job_title, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code, departments(name)",
        )
        .in("id", scheduleOnlyIds);
      if (error) throw error;
      return ((data ?? []) as any[]).map((row) => ({
        id: row.id as string,
        full_name: row.full_name as string,
        job_title: (row.job_title as string | null) ?? null,
        department_name:
          (row.departments?.name as string | null | undefined) ?? null,
        excluded_from_headcount: !!row.excluded_from_headcount,
        on_leave: !!row.on_leave,
        leave_start_date: (row.leave_start_date as string | null) ?? null,
        leave_end_date: (row.leave_end_date as string | null) ?? null,
        leave_type_code: (row.leave_type_code as string | null) ?? null,
      }));
    },
    staleTime: 60_000,
  });

  // RealtimeBridge already invalidates dashboard-shift-cards.
  // Group by shift: published assignments + profile leave windows for חופש.
  // Same headcount rule: תפקיד "לא נכלל במצבת" omitted from numbers/lists.
  const byShift = useMemo(() => {
    const empMap = new Map<string, EmployeeInfo>();
    for (const e of leaveEmpsQ.data ?? []) empMap.set(e.id, e);
    for (const e of scheduleEmpsQ.data ?? []) empMap.set(e.id, e);

    const onLeaveToday = new Set<string>();
    for (const e of leaveEmpsQ.data ?? []) {
      if (!e.excluded_from_headcount) onLeaveToday.add(e.id);
    }

    const byShift = new Map<string, DisplayEmployee[]>();
    const seenByShift = new Map<string, Set<string>>();
    for (const def of shiftDefsQ.list) {
      byShift.set(def.code, []);
      seenByShift.set(def.code, new Set());
    }

    // Wait for profile flags before counting so excluded roles never flash into totals.
    const waitingScheduleEmps =
      scheduleOnlyIds.length > 0 && !scheduleEmpsQ.data;
    const waitingLeaveEmps = leaveEmpsQ.isLoading;
    if (waitingScheduleEmps || waitingLeaveEmps) return byShift;

    const pushEmp = (
      shiftCode: string,
      empId: string,
      start: string | null,
      end: string | null,
    ) => {
      const def = shiftDefsQ.map.get(shiftCode);
      if (!def || !def.is_active) return;
      const info = empMap.get(empId);
      if (info?.excluded_from_headcount) return;
      const seen = seenByShift.get(shiftCode);
      if (!seen || seen.has(empId)) return;
      seen.add(empId);
      const list = byShift.get(shiftCode) ?? [];
      list.push({
        id: empId,
        full_name: info?.full_name ?? "עובד",
        job_title: info?.job_title ?? null,
        department_name: info?.department_name ?? null,
        excluded_from_headcount: false,
        on_leave: info?.on_leave ?? false,
        leave_start_date: info?.leave_start_date ?? null,
        leave_end_date: info?.leave_end_date ?? null,
        leave_type_code: info?.leave_type_code ?? null,
        start: start ? formatHHMM(start) : null,
        end: end ? formatHHMM(end) : null,
      });
      byShift.set(shiftCode, list);
    };

    for (const r of rowsQ.data ?? []) {
      // Profile leave wins over a published בוקר/ערב cell (same as schedule UI).
      const shiftCode = onLeaveToday.has(r.employee_id) ? OFF_SHIFT_CODE : r.shift;
      const def = shiftDefsQ.map.get(shiftCode);
      const resolved = shiftCode === OFF_SHIFT_CODE ? null : shiftDefsQ.getTimesForDay(shiftCode, dateISO);
      const start =
        shiftCode === OFF_SHIFT_CODE
          ? null
          : r.start_time ?? resolved?.start_time ?? null;
      const end =
        shiftCode === OFF_SHIFT_CODE
          ? null
          : r.end_time ?? resolved?.end_time ?? null;
      pushEmp(shiftCode, r.employee_id, start, end);
    }

    // Leave from employee file / approved request — even with no published schedule.
    for (const emp of leaveEmpsQ.data ?? []) {
      pushEmp(OFF_SHIFT_CODE, emp.id, null, null);
    }

    for (const list of byShift.values()) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
    }
    return byShift;
  }, [
    rowsQ.data,
    leaveEmpsQ.data,
    leaveEmpsQ.isLoading,
    scheduleEmpsQ.data,
    scheduleOnlyIds.length,
    shiftDefsQ.list,
    shiftDefsQ.map,
  ]);

  const [openShift, setOpenShift] = useState<string | null>(null);

  if (!canView || !permsReady) return null;
  if (shiftDefsQ.list.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">
        {isToday
          ? i18n.t("dashboard.todayShifts")
          : i18n.t("dashboard.dayShifts", { date: formatScheduleDayHe(dateISO) })}
      </h2>
      <div
        className="grid gap-2"
        style={{
          gridTemplateColumns: `repeat(${Math.min(shiftDefsQ.list.length, 4)}, minmax(0, 1fr))`,
        }}
      >
        {shiftDefsQ.list.map((def) => {
          const list = byShift.get(def.code) ?? [];
          const count = list.length;
          const countLabel =
            count === 0
              ? i18n.t("dashboard.zeroEmployees")
              : count === 1
                ? i18n.t("dashboard.oneEmployee")
                : i18n.t("dashboard.nEmployeesCount").replace("{n}", String(count));
          const resolved = shiftDefsQ.getTimesForDay(def.code, dateISO);
          const defaultRange =
            formatShiftTimeRange(resolved.start_time, resolved.end_time) ??
            formatShiftTimeRange(def.start_time, def.end_time) ??
            "";
          return (
            <ShiftCard
              key={def.id}
              name={
                def.code === "morning" || def.code === "evening" || def.code === "off"
                  ? i18n.t(`dashboard.${def.code}`)
                  : def.name
              }
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
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openShift
                ? (openShift === "morning" || openShift === "evening" || openShift === "off"
                    ? i18n.t(`dashboard.${openShift}`)
                    : shiftDefsQ.map.get(openShift)?.name) ?? i18n.t("dashboard.shift")
                : i18n.t("dashboard.shift")}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const list = openShift ? byShift.get(openShift) ?? [] : [];
            const isOffList = openShift === OFF_SHIFT_CODE;
            if (list.length === 0) {
              return (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {isOffList
                    ? i18n.t("dashboard.noLeaveToday")
                    : i18n.t("dashboard.noEmployeesThisShift")}
                </p>
              );
            }
            return (
              <ul className="divide-y max-h-[60vh] overflow-y-auto">
                {list.map((e) => {
                  if (isOffList) {
                    const range = formatLeaveDateRange(
                      e.leave_start_date,
                      e.leave_end_date,
                    );
                    const days = countLeaveDays(
                      e.leave_start_date,
                      e.leave_end_date,
                    );
                    const typeLabel = leaveOffLabel(e.leave_type_code);
                    return (
                      <li key={e.id} className="py-2.5 space-y-0.5">
                        <div className="font-medium truncate">{e.full_name}</div>
                        {e.department_name && (
                          <div className="text-xs text-muted-foreground truncate">
                            {e.department_name}
                          </div>
                        )}
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                          <span>{typeLabel}</span>
                          {range && <span>· {range}</span>}
                          {days != null && (
                            <span>
                              · {days} {days === 1 ? i18n.t("dashboard.day") : i18n.t("common.days")}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{e.full_name}</div>
                        {e.department_name && (
                          <div className="text-xs text-muted-foreground truncate">
                            {e.department_name}
                          </div>
                        )}
                        {e.job_title && (
                          <div className="text-[11px] text-muted-foreground/80 truncate">
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
                  );
                })}
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
      className="flex min-h-[4.75rem] w-full items-center gap-2 rounded-xl border bg-card p-3 text-right transition-colors hover:bg-accent/30 focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={`${name}: ${countLabel}`}
    >
      <div className="min-w-0 flex-1 self-center">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="truncate text-sm font-semibold leading-tight">{name}</span>
        </div>
        {defaultRange ? (
          <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground" dir="ltr">
            {defaultRange}
          </div>
        ) : null}
        <div className="mt-0.5 text-[11px] text-muted-foreground">{countLabel}</div>
      </div>
      <div className="flex h-7 w-[4.75rem] shrink-0 items-center justify-end gap-1">
        <span className="text-2xl font-bold tabular-nums leading-none" style={{ color }}>
          {count}
        </span>
        <Users className="size-3.5 shrink-0 text-muted-foreground" />
      </div>
    </button>
  );
};
