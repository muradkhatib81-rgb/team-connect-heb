import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Clock, Loader2, Moon, Plane, Sun, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useShiftDefinitions } from "@/lib/use-shift-definitions";
import { formatHHMM, usePlatformNow } from "@/lib/platform-time";
import {
  formatScheduleDayHe,
  scheduleDayLabelForDate,
} from "@/lib/schedule-week";
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
import {
  getBranchPeriodScheduleShifts,
  getDashboardPublishedPeriods,
} from "@/lib/schedules.functions";
import { useSchedulePeriodConfig } from "@/lib/use-schedule-period-config";
import {
  buildPeriodDays,
  DEFAULT_PERIOD_CONFIG,
  getReferencePeriodStart,
} from "@/lib/schedule-period-config";
import { cn } from "@/lib/utils";

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
  excluded_from_headcount: boolean;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_code: string | null;
};

type DisplayEmployee = EmployeeInfo & { start: string | null; end: string | null };

const OFF_SHIFT_CODE = "off";
const CORE_SHIFT_CODES = ["morning", "evening", "off"] as const;

/**
 * Single dashboard card: published schedule headcount for a chosen day (branch-wide).
 * Visible to branch-level schedule viewers only.
 */
export function LiveShiftCardsSection() {
  const { data: profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const periodConfigQ = useSchedulePeriodConfig();
  const periodConfig = periodConfigQ.data ?? DEFAULT_PERIOD_CONFIG;
  const branchShiftsFn = useServerFn(getBranchPeriodScheduleShifts);
  const periodsFn = useServerFn(getDashboardPublishedPeriods);
  const { dateISO: todayISO } = usePlatformNow();

  const [open, setOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [openShift, setOpenShift] = useState<string | null>(null);

  useEffect(() => {
    setSelectedDate(todayISO);
  }, [todayISO]);

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

  const periodsQ = useQuery({
    enabled: canView && permsReady,
    queryKey: ["dashboard-published-periods", "branch", activeBranchId ?? "all"],
    queryFn: () => periodsFn({ data: { scope: "branch" } }),
    staleTime: 30_000,
  });

  const dayOptions = useMemo(() => {
    const periods = periodsQ.data?.periods ?? [];
    const containing = periods.find(
      (p) => p.periodStart <= selectedDate && p.periodEnd >= selectedDate,
    );
    if (!containing) {
      if (!periodConfigQ.isSuccess) return [selectedDate];
      const fallbackDays = buildPeriodDays(
        getReferencePeriodStart(selectedDate, periodConfig),
        periodConfig,
      );
      return fallbackDays.length ? fallbackDays : [selectedDate];
    }
    const days = buildPeriodDays(containing.weekStart, periodConfig);
    return days.filter(
      (day) => day >= containing.periodStart && day <= containing.periodEnd,
    );
  }, [periodsQ.data?.periods, selectedDate, periodConfig, periodConfigQ.isSuccess]);

  useEffect(() => {
    if (dayOptions.length && !dayOptions.includes(selectedDate)) {
      const fallback =
        dayOptions.find((d) => d >= todayISO) ?? dayOptions[dayOptions.length - 1]!;
      setSelectedDate(fallback);
    }
  }, [dayOptions, selectedDate, todayISO]);

  const periodWeekStart = useMemo(() => {
    if (!periodConfigQ.isSuccess || !selectedDate) return null;
    return getReferencePeriodStart(selectedDate, periodConfig);
  }, [
    periodConfigQ.isSuccess,
    selectedDate,
    periodConfig.schedule_type,
    periodConfig.week_start_dow,
    periodConfig.week_end_dow,
  ]);

  const rowsQ = useQuery<TodayRow[]>({
    enabled: canView && permsReady && !!selectedDate && !!periodWeekStart,
    queryKey: [
      "dashboard-shift-cards",
      "published",
      selectedDate,
      periodWeekStart,
      activeBranchId ?? "all",
    ],
    queryFn: async () => {
      const { shifts } = await branchShiftsFn({
        data: { week_start: periodWeekStart!, published_only: true },
      });
      return (shifts ?? [])
        .filter((row) => row.day_date === selectedDate)
        .map((row) => ({
          employee_id: row.employee_id,
          shift: row.shift,
          start_time: row.start_time ?? null,
          end_time: row.end_time ?? null,
          schedule_id: row.schedule_id,
        }));
    },
    staleTime: 30_000,
  });

  const scheduleEmpIds = useMemo(
    () => Array.from(new Set((rowsQ.data ?? []).map((r) => r.employee_id))),
    [rowsQ.data],
  );

  const scheduleEmpsQ = useQuery<EmployeeInfo[]>({
    enabled: scheduleEmpIds.length > 0,
    queryKey: [
      "dashboard-shift-cards",
      "published-emps",
      scheduleEmpIds.slice().sort().join(","),
    ],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, job_title, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code, departments(name)",
        )
        .in("id", scheduleEmpIds);
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

  const coreShiftDefs = useMemo(
    () =>
      CORE_SHIFT_CODES.map((code) => shiftDefsQ.map.get(code)).filter(
        (def): def is NonNullable<typeof def> => !!def && def.is_active,
      ),
    [shiftDefsQ.map],
  );

  const byShift = useMemo(() => {
    const empMap = new Map<string, EmployeeInfo>();
    for (const e of scheduleEmpsQ.data ?? []) empMap.set(e.id, e);

    const byShift = new Map<string, DisplayEmployee[]>();
    const seenByShift = new Map<string, Set<string>>();
    for (const code of CORE_SHIFT_CODES) {
      byShift.set(code, []);
      seenByShift.set(code, new Set());
    }

    if (rowsQ.isLoading || (scheduleEmpIds.length > 0 && !scheduleEmpsQ.data)) {
      return byShift;
    }

    const pushEmp = (
      shiftCode: string,
      empId: string,
      start: string | null,
      end: string | null,
    ) => {
      if (!CORE_SHIFT_CODES.includes(shiftCode as (typeof CORE_SHIFT_CODES)[number])) {
        return;
      }
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
      const emp = empMap.get(r.employee_id);
      const onLeave = emp
        ? isEmployeeOnLeaveOnDate(
            {
              on_leave: emp.on_leave,
              leave_start_date: emp.leave_start_date,
              leave_end_date: emp.leave_end_date,
            },
            selectedDate,
          )
        : false;
      const shiftCode = onLeave ? OFF_SHIFT_CODE : r.shift;
      const resolved =
        shiftCode === OFF_SHIFT_CODE
          ? null
          : shiftDefsQ.getTimesForDay(shiftCode, selectedDate);
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

    for (const list of byShift.values()) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
    }
    return byShift;
  }, [
    rowsQ.data,
    rowsQ.isLoading,
    scheduleEmpsQ.data,
    scheduleEmpIds.length,
    selectedDate,
    shiftDefsQ,
  ]);

  const isLoading = rowsQ.isLoading || (scheduleEmpIds.length > 0 && !scheduleEmpsQ.data);

  const summaryParts = coreShiftDefs.map((def) => {
    const count = byShift.get(def.code)?.length ?? 0;
    const label =
      def.code === "morning" || def.code === "evening" || def.code === "off"
        ? i18n.t(`dashboard.${def.code}`)
        : def.name;
    return `${label} ${count}`;
  });

  const shiftTone = (code: string) => {
    if (code === "morning") {
      return {
        label: i18n.t("dashboard.morning"),
        icon: Sun,
        activeClass: "ring-2 ring-amber-500 border-amber-400 bg-amber-50",
        idleClass: "border-amber-200 bg-amber-50/40 hover:bg-amber-50",
        color: shiftDefsQ.map.get("morning")?.color ?? "#f59e0b",
      };
    }
    if (code === "evening") {
      return {
        label: i18n.t("dashboard.evening"),
        icon: Moon,
        activeClass: "ring-2 ring-sky-500 border-sky-400 bg-sky-50",
        idleClass: "border-sky-200 bg-sky-50/40 hover:bg-sky-50",
        color: shiftDefsQ.map.get("evening")?.color ?? "#0ea5e9",
      };
    }
    return {
      label: i18n.t("dashboard.off"),
      icon: Plane,
      activeClass: "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50",
      idleClass: "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50",
      color: shiftDefsQ.map.get("off")?.color ?? "#10b981",
    };
  };

  if (!canView || !permsReady) return null;
  if (coreShiftDefs.length === 0) return null;

  return (
    <section>
      <Collapsible open={open} onOpenChange={setOpen}>
        <Card className="card-elevated overflow-hidden">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-2.5 p-3 text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                <Clock className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold leading-tight">
                  {i18n.t("dashboard.employeesByDayShifts")}
                </h3>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                  {isLoading ? i18n.t("common.loading") : summaryParts.join(" · ")}
                </p>
              </div>
              <ChevronDown
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>

          <CollapsibleContent>
            <div className="space-y-3 border-t p-3">
              <div className="overflow-x-auto">
                <div className="flex min-w-max gap-1">
                  {dayOptions.map((day) => {
                    const isSelected = day === selectedDate;
                    const isDayToday = day === todayISO;
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDate(day)}
                        className={cn(
                          "flex min-w-[4.5rem] flex-col items-center rounded-lg border px-2 py-2 text-center transition-colors",
                          isSelected
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-transparent hover:bg-muted/50",
                          isDayToday && !isSelected && "border-primary/30",
                        )}
                      >
                        <span className="text-xs font-semibold">
                          {scheduleDayLabelForDate(day, "full")}
                        </span>
                        <span className="text-[10px] tabular-nums text-muted-foreground">
                          {formatScheduleDayHe(day)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {isLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="size-5 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {coreShiftDefs.map((def) => {
                    const tone = shiftTone(def.code);
                    const Icon = tone.icon;
                    const list = byShift.get(def.code) ?? [];
                    const count = list.length;
                    const resolved = shiftDefsQ.getTimesForDay(def.code, selectedDate);
                    const defaultRange =
                      formatShiftTimeRange(resolved.start_time, resolved.end_time) ??
                      formatShiftTimeRange(def.start_time, def.end_time) ??
                      "";
                    return (
                      <button
                        key={def.id}
                        type="button"
                        onClick={() => setOpenShift(def.code)}
                        className={cn(
                          "rounded-lg border p-2.5 text-center transition-all",
                          tone.idleClass,
                        )}
                      >
                        <div className="flex items-center justify-center gap-1 text-xs font-medium">
                          <Icon className="size-3.5" />
                          {tone.label}
                        </div>
                        {defaultRange ? (
                          <div
                            className="mt-0.5 text-[10px] tabular-nums text-muted-foreground"
                            dir="ltr"
                          >
                            {defaultRange}
                          </div>
                        ) : null}
                        <div
                          className="mt-1 text-2xl font-bold tabular-nums leading-none"
                          style={{ color: tone.color }}
                        >
                          {count}
                        </div>
                        <div className="mt-0.5 flex items-center justify-center gap-1 text-[10px] text-muted-foreground">
                          <Users className="size-3" />
                          {count === 1
                            ? i18n.t("dashboard.oneEmployee")
                            : count === 0
                              ? i18n.t("dashboard.zeroEmployees")
                              : i18n.t("dashboard.nEmployeesCount").replace(
                                  "{n}",
                                  String(count),
                                )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      <Dialog open={!!openShift} onOpenChange={(o) => !o && setOpenShift(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {openShift
                ? (openShift === "morning" ||
                  openShift === "evening" ||
                  openShift === "off"
                    ? i18n.t(`dashboard.${openShift}`)
                    : shiftDefsQ.map.get(openShift)?.name) ??
                  i18n.t("dashboard.shift")
                : i18n.t("dashboard.shift")}
              {" · "}
              {formatScheduleDayHe(selectedDate)}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const list = openShift ? byShift.get(openShift) ?? [] : [];
            const isOffList = openShift === OFF_SHIFT_CODE;
            if (list.length === 0) {
              return (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {isOffList
                    ? i18n.t("dashboard.noLeaveToday")
                    : i18n.t("dashboard.noEmployeesThisShift")}
                </p>
              );
            }
            return (
              <ul className="max-h-[60vh] divide-y overflow-y-auto">
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
                      <li key={e.id} className="space-y-0.5 py-2.5">
                        <div className="truncate font-medium">{e.full_name}</div>
                        {e.department_name && (
                          <div className="truncate text-xs text-muted-foreground">
                            {e.department_name}
                          </div>
                        )}
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                          <span>{typeLabel}</span>
                          {range && <span>· {range}</span>}
                          {days != null && (
                            <span>
                              · {days}{" "}
                              {days === 1
                                ? i18n.t("dashboard.day")
                                : i18n.t("common.days")}
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate font-medium">{e.full_name}</div>
                        {e.department_name && (
                          <div className="truncate text-xs text-muted-foreground">
                            {e.department_name}
                          </div>
                        )}
                        {e.job_title && (
                          <div className="truncate text-[11px] text-muted-foreground/80">
                            {e.job_title}
                          </div>
                        )}
                      </div>
                      {e.start && e.end && (
                        <div
                          className="shrink-0 text-xs tabular-nums text-muted-foreground"
                          dir="ltr"
                        >
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
