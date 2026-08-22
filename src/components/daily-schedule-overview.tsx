import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Building2,
  CalendarDays,
  Loader2,
  Moon,
  Plane,
  RefreshCw,
  Sun,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import {
  effectiveScheduleShift,
  isEmployeeOnLeaveOnDate,
  leaveOffLabel,
  type EmployeeLeaveFields,
} from "@/lib/employee-leave";
import {
  formatScheduleDayHe,
  scheduleDayLabelForDate,
  type ScheduleShiftCode,
} from "@/lib/schedule-week";
import { useSchedulePeriodConfig } from "@/lib/use-schedule-period-config";
import {
  DEFAULT_PERIOD_CONFIG,
  buildPeriodDays,
  getReferencePeriodStart,
} from "@/lib/schedule-period-config";
import i18n from "@/i18n";
import {
  buildChangeBaselineFromShiftRow,
  diffScheduleCellForViewer,
  type ScheduleChangeBaselineKind,
} from "@/lib/schedule-publish-diff";
import { trimScheduleNote } from "@/lib/schedule-note";
import { formatShiftTimeRange } from "@/lib/shift-hours";
import { resolveScheduleManagerCaps } from "@/lib/schedule-manager-caps";
import { useAuth } from "@/lib/use-auth";
import { useShiftDefinitions, type ShiftDef } from "@/lib/use-shift-definitions";
import { cn } from "@/lib/utils";
import {
  getDailyScheduleOverview,
  getDepartmentWeekScheduleFlags,
} from "@/lib/schedules.functions";

export type DailyScheduleScope = "branch" | "department";

type DeptEmployee = EmployeeLeaveFields & {
  id: string;
  full_name: string;
  excluded_from_schedule?: boolean;
  excluded_from_headcount?: boolean;
};

type ShiftRow = {
  employee_id: string;
  day_date: string;
  shift: string;
  leave_type_code?: string | null;
  published_shift: string | null;
  published_note: string | null;
  published_start_time: string | null;
  published_end_time: string | null;
  submitted_shift: string | null;
  submitted_note: string | null;
  submitted_start_time: string | null;
  submitted_end_time: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
  schedule_id: string;
};

type DeptScheduleMeta = {
  id: string;
  overviewKey?: string;
  name: string;
  hasPublishedSchedule: boolean;
  scheduleId: string | null;
  scheduleWeekStart?: string | null;
  scheduleWeekEnd?: string | null;
  hasSavedAwaitingPublish: boolean;
  changeBaselineKind: ScheduleChangeBaselineKind;
};

export type DailyScheduleEmployeeRow = {
  id: string;
  full_name: string;
  shift: ScheduleShiftCode;
  shiftLabel: string;
  timeRange: string | null;
  note: string | null;
  isModified: boolean;
  isNoteModified: boolean;
  isTimeModified: boolean;
  isSelf: boolean;
};

const SHIFT_ORDER: Record<ScheduleShiftCode, number> = {
  morning: 0,
  evening: 1,
  off: 2,
};

function getShiftLabel(code: ScheduleShiftCode): string {
  const map: Record<ScheduleShiftCode, string> = {
    morning: "dashboard.morning",
    evening: "dashboard.evening",
    off: "dashboard.off",
  };
  return i18n.t(map[code]);
}

type DeptShiftFilter = { deptId: string; shift: ScheduleShiftCode };

function normHm(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return null;
}

function resolveTimeRange(
  row: ShiftRow | undefined,
  shift: ScheduleShiftCode,
  resolved?: { start_time?: string | null; end_time?: string | null },
): string | null {
  if (shift === "off") return null;
  const start = normHm(row?.start_time) ?? normHm(resolved?.start_time);
  const end = normHm(row?.end_time) ?? normHm(resolved?.end_time);
  return formatShiftTimeRange(start, end);
}

function normalizeShift(
  emp: DeptEmployee,
  day: string,
  rawShift: string | null | undefined,
): ScheduleShiftCode {
  const effective = effectiveScheduleShift(
    emp,
    day,
    (rawShift as ScheduleShiftCode | undefined) ?? "off",
  );
  if (effective === "morning" || effective === "evening" || effective === "off") return effective;
  return "off";
}

function isCountedInDailySummary(emp: DeptEmployee): boolean {
  return !emp.excluded_from_headcount;
}

function computeDeptDayCounts(
  dept: DeptScheduleMeta,
  employeesByDept: Record<string, DeptEmployee[]>,
  shifts: ShiftRow[],
  selectedDay: string,
): Record<ScheduleShiftCode, number> {
  const counts: Record<ScheduleShiftCode, number> = { morning: 0, evening: 0, off: 0 };
  if (!dept.scheduleId) return counts;

  const empMap = new Map((employeesByDept[dept.id] ?? []).map((e) => [e.id, e]));
  const processedIds = new Set<string>();

  for (const row of shifts) {
    if (row.schedule_id !== dept.scheduleId || row.day_date !== selectedDay) continue;
    const emp = empMap.get(row.employee_id);
    if (emp?.excluded_from_schedule) continue;
    if (emp && !isCountedInDailySummary(emp)) continue;
    const stub: DeptEmployee = emp ?? {
      id: row.employee_id,
      full_name: "",
      on_leave: false,
      leave_start_date: null,
      leave_end_date: null,
    };
    const shift = normalizeShift(stub, selectedDay, row.shift);
    counts[shift] += 1;
    processedIds.add(row.employee_id);
  }

  // Count employees on leave from profile who have no schedule row.
  for (const emp of employeesByDept[dept.id] ?? []) {
    if (emp.excluded_from_schedule) continue;
    if (!isCountedInDailySummary(emp)) continue;
    if (processedIds.has(emp.id)) continue;
    if (isEmployeeOnLeaveOnDate(emp, selectedDay)) counts.off += 1;
  }

  return counts;
}

function buildDepartmentEmployeeRows(args: {
  dept: DeptScheduleMeta;
  employeesByDept: Record<string, DeptEmployee[]>;
  shifts: ShiftRow[];
  selectedDay: string;
  shiftFilter?: ScheduleShiftCode | null;
  shiftDefs: Map<string, ShiftDef>;
  getTimesForDay: (code: string | null | undefined, dayDate: string) => {
    start_time: string | null;
    end_time: string | null;
  };
  selfId?: string;
  includeSubmittedDiffWhenPublished: boolean;
  showAllDepartmentEmployees?: boolean;
}): DailyScheduleEmployeeRow[] {
  const {
    dept,
    employeesByDept,
    shifts,
    selectedDay,
    shiftFilter = null,
    shiftDefs,
    getTimesForDay,
    selfId,
    includeSubmittedDiffWhenPublished,
    showAllDepartmentEmployees = false,
  } = args;
  if (!dept.scheduleId) return [];

  const empMap = new Map((employeesByDept[dept.id] ?? []).map((e) => [e.id, e]));
  const dayShifts = shifts.filter(
    (s) => s.schedule_id === dept.scheduleId && s.day_date === selectedDay,
  );

  const rows: DailyScheduleEmployeeRow[] = [];
  for (const raw of dayShifts) {
    const emp = empMap.get(raw.employee_id);
    if (emp?.excluded_from_schedule) continue;
    if (emp && !isCountedInDailySummary(emp)) continue;

    const stub: DeptEmployee = emp ?? {
      id: raw.employee_id,
      full_name: "עובד/ת",
      on_leave: false,
      leave_start_date: null,
      leave_end_date: null,
    };
    const shift = normalizeShift(stub, selectedDay, raw.shift);
    if (shiftFilter != null && shift !== shiftFilter) continue;

    const def = shiftDefs.get(shift);
    const resolvedTimes = getTimesForDay(shift, selectedDay);
    const rawNote = raw.note ? trimScheduleNote(String(raw.note)) : "";
    const submittedBaseline = buildChangeBaselineFromShiftRow(raw, "submitted", shiftDefs);
    const publishedBaseline = buildChangeBaselineFromShiftRow(raw, "published", shiftDefs);
    const start = normHm(raw.start_time) ?? normHm(resolvedTimes.start_time);
    const end = normHm(raw.end_time) ?? normHm(resolvedTimes.end_time);
    const { isShiftModified, isNoteModified, isTimeModified } = diffScheduleCellForViewer({
      currentShift: shift,
      currentStart: start,
      currentEnd: end,
      currentNote: rawNote || null,
      baselineKind: dept.changeBaselineKind,
      submittedBaseline,
      publishedBaseline,
      currentShiftDef: def,
      includeSubmittedDiffWhenPublished,
    });

    rows.push({
      id: stub.id,
      full_name: stub.full_name,
      shift,
      shiftLabel:
        shift === "off"
          ? leaveOffLabel(raw.leave_type_code ?? stub.leave_type_code)
          : getShiftLabel(shift),
      timeRange: resolveTimeRange(raw, shift, resolvedTimes),
      note: rawNote || null,
      isModified: isShiftModified,
      isNoteModified,
      isTimeModified,
      isSelf: !!selfId && stub.id === selfId,
    });
  }

  // Employees who are on leave in their profile but have no shift row in the
  // schedule still need to appear in the חופש bucket. Add them now.
  const processedIds = new Set(rows.map((r) => r.id));
  for (const emp of employeesByDept[dept.id] ?? []) {
    if (emp.excluded_from_schedule) continue;
    if (!isCountedInDailySummary(emp)) continue;
    if (processedIds.has(emp.id)) continue;
    if (!isEmployeeOnLeaveOnDate(emp, selectedDay)) continue;

    const leaveLabel = leaveOffLabel(emp.leave_type_code);
    if (shiftFilter != null && shiftFilter !== "off") continue;

    rows.push({
      id: emp.id,
      full_name: emp.full_name,
      shift: "off",
      shiftLabel: leaveLabel,
      timeRange: null,
      note: null,
      isModified: false,
      isNoteModified: false,
      isTimeModified: false,
      isSelf: !!selfId && emp.id === selfId,
    });
    processedIds.add(emp.id);
  }

  if (showAllDepartmentEmployees) {
    for (const emp of employeesByDept[dept.id] ?? []) {
      if (emp.excluded_from_schedule) continue;
      if (!isCountedInDailySummary(emp)) continue;
      if (processedIds.has(emp.id)) continue;
      if (shiftFilter != null && shiftFilter !== "off") continue;
      rows.push({
        id: emp.id,
        full_name: emp.full_name,
        shift: "off",
        shiftLabel: getShiftLabel("off"),
        timeRange: null,
        note: null,
        isModified: false,
        isNoteModified: false,
        isTimeModified: false,
        isSelf: !!selfId && emp.id === selfId,
      });
    }
  }

  rows.sort((a, b) => {
    const shiftOrder = SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift];
    if (shiftOrder !== 0) return shiftOrder;
    return a.full_name.localeCompare(b.full_name, "he");
  });
  return rows;
}

export type DailyScheduleOverviewProps = {
  scope: DailyScheduleScope;
  departmentId?: string | null;
  selfUserId?: string;
  useCoworkersView?: boolean;
  showFullScheduleLink?: boolean;
  /** When set, load this schedule period instead of the current reference period. */
  weekStart?: string;
  /** Render inside a parent card — no outer Card wrapper or period header. */
  embedded?: boolean;
  className?: string;
  onSelectedDayChange?: (day: string) => void;
  /** When false, day changes are not propagated (e.g. collapsed period card). */
  reportDayChanges?: boolean;
};

export function DailyScheduleOverview({
  scope,
  departmentId,
  selfUserId,
  useCoworkersView = false,
  showFullScheduleLink = true,
  weekStart: weekStartProp,
  embedded = false,
  className,
  onSelectedDayChange,
  reportDayChanges = true,
}: DailyScheduleOverviewProps) {
  const { data: profile } = useAuth();
  const getOverviewFn = useServerFn(getDailyScheduleOverview);
  const getDeptFlagsFn = useServerFn(getDepartmentWeekScheduleFlags);
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const periodConfigQ = useSchedulePeriodConfig();
  const periodConfig = periodConfigQ.data ?? DEFAULT_PERIOD_CONFIG;

  const todayIso = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      .toISOString()
      .slice(0, 10);
  }, []);

  const weekStart = useMemo(() => {
    if (weekStartProp) return weekStartProp;
    if (!periodConfigQ.isSuccess) return todayIso;
    return getReferencePeriodStart(todayIso, periodConfig);
  }, [
    weekStartProp,
    periodConfigQ.isSuccess,
    todayIso,
    periodConfig.schedule_type,
    periodConfig.week_start_dow,
    periodConfig.week_end_dow,
  ]);

  const localWeekDays = useMemo(
    () => buildPeriodDays(weekStart, periodConfig),
    [weekStart, periodConfig.schedule_type, periodConfig.week_start_dow, periodConfig.week_end_dow],
  );
  const weekEnd = localWeekDays[localWeekDays.length - 1] ?? weekStart;

  const permsQ = useQuery({
    enabled: !!profile?.id && !useCoworkersView,
    queryKey: ["my-perms", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_view_schedule, can_create_schedule, can_edit_schedule, can_approve_schedule, can_publish_schedule")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return (
        data ?? {
          can_view_schedule: false,
          can_create_schedule: false,
          can_edit_schedule: false,
          can_approve_schedule: false,
          can_publish_schedule: false,
        }
      );
    },
  });

  const includeSubmittedDiffWhenPublished = useMemo(() => {
    if (useCoworkersView || !profile) return false;
    const caps = resolveScheduleManagerCaps(profile.roles, permsQ.data ?? {});
    return (
      caps.isMainAdmin ||
      caps.isBranchMgr ||
      caps.isDeptMgr ||
      caps.canApprove ||
      caps.canPublishDirect
    );
  }, [useCoworkersView, profile, permsQ.data]);

  const queryKey = [
    "daily-schedule-overview",
    scope,
    departmentId ?? "all",
    weekStart,
    useCoworkersView,
  ] as const;

  const q = useQuery({
    queryKey,
    queryFn: () =>
      getOverviewFn({
        data: {
          week_start: weekStart,
          scope,
          department_id: departmentId ?? undefined,
          use_coworkers_view: useCoworkersView,
        },
      }),
    enabled: (scope === "branch" || !!departmentId) && periodConfigQ.isSuccess,
    staleTime: 30_000,
  });

  const weekDays = useMemo(() => {
    const fromServer = (q.data as { weekDays?: string[] } | undefined)?.weekDays;
    if (fromServer?.length) return fromServer;
    return localWeekDays;
  }, [q.data, localWeekDays]);

  const displayWeekStart =
    (q.data as { weekStart?: string } | undefined)?.weekStart ?? weekStart;
  const displayWeekEnd =
    (q.data as { weekEnd?: string } | undefined)?.weekEnd ?? weekEnd;

  const defaultDay = weekDays.includes(todayIso)
    ? todayIso
    : weekDays.find((d) => d >= todayIso) ?? weekDays[0]!;
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [activeFilter, setActiveFilter] = useState<DeptShiftFilter | null>(null);

  useEffect(() => {
    setSelectedDay(defaultDay);
    setActiveFilter(null);
  }, [weekStart, defaultDay, q.data]);

  useEffect(() => {
    if (reportDayChanges) onSelectedDayChange?.(selectedDay);
  }, [selectedDay, onSelectedDayChange, reportDayChanges]);

  const deptFlagsQ = useQuery({
    queryKey: ["dept-schedule-flags", departmentId, weekStart],
    queryFn: () =>
      getDeptFlagsFn({
        data: { department_id: departmentId!, week_start: weekStart },
      }),
    enabled: scope === "department" && !!departmentId,
    staleTime: 30_000,
  });

  // RealtimeBridge already invalidates daily-schedule-overview / dept-schedule-flags.

  const departments = useMemo(() => {
    const base = (q.data?.departments ?? []) as DeptScheduleMeta[];
    if (scope !== "department" || !deptFlagsQ.data) return base;
    if (useCoworkersView) {
      return base.map((d) => ({
        ...d,
        hasPublishedSchedule: d.hasPublishedSchedule || !!d.scheduleId,
        hasSavedAwaitingPublish: false,
      }));
    }
    const flags = deptFlagsQ.data;
    return base.map((d) => {
      const hasPublished = d.hasPublishedSchedule || flags.hasPublished;
      const scheduleId = d.scheduleId ?? flags.publishedScheduleId ?? null;
      const hasSavedAwaitingPublish =
        useCoworkersView
          ? flags.hasSavedAwaitingPublish && !hasPublished
          : flags.hasSavedAwaitingPublish;
      return {
        ...d,
        hasPublishedSchedule: hasPublished,
        scheduleId,
        hasSavedAwaitingPublish,
      };
    });
  }, [q.data?.departments, scope, deptFlagsQ.data, useCoworkersView]);

  const employeesByDept = (q.data?.employeesByDept ?? {}) as Record<string, DeptEmployee[]>;
  const shifts = (q.data?.shifts ?? []) as ShiftRow[];

  const deptCounts = useMemo(() => {
    const out: Record<string, Record<ScheduleShiftCode, number>> = {};
    for (const dept of departments) {
      const key = dept.overviewKey ?? dept.id;
      out[key] = computeDeptDayCounts(dept, employeesByDept, shifts, selectedDay);
    }
    return out;
  }, [departments, employeesByDept, shifts, selectedDay]);

  const selectedDayName = selectedDay ? scheduleDayLabelForDate(selectedDay, "full") : "";

  const toggleDeptFilter = (deptId: string, shift: ScheduleShiftCode) => {
    setActiveFilter((prev) =>
      prev?.deptId === deptId && prev.shift === shift ? null : { deptId, shift },
    );
  };

  const shiftTone = (code: ScheduleShiftCode) => {
    if (code === "morning") {
      return {
        badge: "bg-amber-100 text-amber-900 border-amber-300",
        row: "bg-amber-50/60 border-amber-100",
        label: i18n.t("dashboard.morning"),
        activeClass: "ring-2 ring-amber-500 border-amber-400 bg-amber-50",
        idleClass: "border-amber-200 bg-amber-50/40 hover:bg-amber-50",
        icon: Sun,
      };
    }
    if (code === "evening") {
      return {
        badge: "bg-sky-100 text-sky-900 border-sky-300",
        row: "bg-sky-50/60 border-sky-100",
        label: i18n.t("dashboard.evening"),
        activeClass: "ring-2 ring-sky-500 border-sky-400 bg-sky-50",
        idleClass: "border-sky-200 bg-sky-50/40 hover:bg-sky-50",
        icon: Moon,
      };
    }
    return {
      badge: "bg-emerald-100 text-emerald-900 border-emerald-300",
      row: "bg-emerald-50/60 border-emerald-100",
      label: i18n.t("dashboard.off"),
      activeClass: "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50",
      idleClass: "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50",
      icon: Plane,
    };
  };

  const shiftCards: ScheduleShiftCode[] = ["morning", "evening", "off"];
  const hasAnyPublished = departments.some((d) => d.hasPublishedSchedule);

  const body = q.isLoading ? (
    <div className="flex justify-center py-12">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  ) : q.isError ? (
    <p className="p-6 text-sm text-destructive text-center">
      {(q.error as Error)?.message ?? i18n.t("dashboard.scheduleLoadError")}
    </p>
  ) : (
    <>
      <div className={cn("px-3 pb-3 overflow-x-auto", embedded && "pt-1")}>
        <div className="flex gap-1 min-w-max">
          {weekDays.map((day) => {
            const isSelected = day === selectedDay;
            const isToday = day === todayIso;
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setSelectedDay(day);
                  setActiveFilter(null);
                }}
                className={cn(
                  "flex flex-col items-center min-w-[4.5rem] px-2 py-2 rounded-lg border text-center transition-colors",
                  isSelected
                    ? "border-primary bg-primary/5 shadow-sm"
                    : "border-transparent hover:bg-muted/50",
                  isToday && !isSelected && "border-primary/30",
                )}
              >
                <span className="text-xs font-semibold">
                  {scheduleDayLabelForDate(day, "full")}
                </span>
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {formatScheduleDayHe(day)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedDayName && (
        <div className="px-4 pb-2 text-xs text-muted-foreground">
          {i18n.t("dashboard.dayOf").replace("{name}", selectedDayName).replace("{date}", formatScheduleDayHe(selectedDay))}
          {activeFilter && (
            <span className="ms-2">
              · {i18n.t("dashboard.showing")} {getShiftLabel(activeFilter.shift)} —{" "}
              {departments.find((d) => d.id === activeFilter.deptId)?.name}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs gap-1 ms-1"
                onClick={() => setActiveFilter(null)}
              >
                <X className="size-3" />
                {i18n.t("common.cancel")}
              </Button>
            </span>
          )}
        </div>
      )}

      <div className="divide-y-[3px] divide-muted-foreground/30 border-t-2 border-muted-foreground/25 max-h-[min(60vh,520px)] overflow-y-auto">
        {departments.map((dept, deptIdx) => {
              const deptKey = dept.overviewKey ?? dept.id;
              const counts = deptCounts[deptKey] ?? { morning: 0, evening: 0, off: 0 };
              const isFilterActive =
                activeFilter?.deptId === deptKey ? activeFilter.shift : null;
              const displayRows = buildDepartmentEmployeeRows({
                dept,
                employeesByDept,
                shifts,
                selectedDay,
                shiftFilter: isFilterActive,
                shiftDefs: shiftDefsQ.map,
                getTimesForDay: shiftDefsQ.getTimesForDay,
                selfId: selfUserId,
                includeSubmittedDiffWhenPublished,
                showAllDepartmentEmployees: useCoworkersView,
              });

              return (
                <section
                  key={deptKey}
                  className={cn(
                    "px-4 py-5",
                    deptIdx % 2 === 1 ? "bg-muted/35" : "bg-background",
                    deptIdx > 0 && "border-t-[3px] border-muted-foreground/30",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 mb-4 pb-3 border-b-2 border-muted-foreground/25">
                    <Building2 className="size-4 text-muted-foreground shrink-0" />
                    <h3 className="font-semibold text-sm">{dept.name}</h3>
                    {dept.scheduleId && dept.scheduleWeekStart && (
                      <Badge variant="outline" className="text-[10px] rounded-full font-normal">
                        {i18n.t("dashboard.schedulePeriodRange")
                          .replace("{start}", formatScheduleDayHe(dept.scheduleWeekStart))
                          .replace(
                            "{end}",
                            formatScheduleDayHe(dept.scheduleWeekEnd ?? dept.scheduleWeekStart),
                          )}
                      </Badge>
                    )}
                  </div>

                  {!dept.scheduleId ? (
                    dept.hasSavedAwaitingPublish ? (
                      <Alert className="ms-6 border-amber-200 bg-amber-50/80">
                        <AlertDescription className="text-sm text-amber-900">
                          {i18n.t("dashboard.scheduleAwaitingPublish")}
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <p className="text-sm text-muted-foreground ps-6">{i18n.t("dashboard.noWeeklyPublished")}</p>
                    )
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-2 ps-1 mb-2">
                        {shiftCards.map((code) => {
                          const tone = shiftTone(code);
                          const Icon = tone.icon;
                          const active = isFilterActive === code;
                          return (
                            <button
                              key={code}
                              type="button"
                              onClick={() => toggleDeptFilter(deptKey, code)}
                              className={cn(
                                "rounded-lg border p-2 text-center transition-all",
                                active ? tone.activeClass : tone.idleClass,
                              )}
                            >
                              <div className="flex items-center justify-center gap-1 text-xs font-medium">
                                <Icon className="size-3.5" />
                                {tone.label}
                              </div>
                              <div className="text-lg font-bold tabular-nums mt-0.5">
                                {counts[code]}
                              </div>
                              {active && (
                                <div className="text-[10px] text-primary mt-0.5 font-medium">
                                  {i18n.t("dashboard.filterActive")}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {displayRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground ps-6">
                          {isFilterActive != null
                            ? i18n.t("dashboard.noEmployeesInShiftDay").replace("{shift}", getShiftLabel(isFilterActive))
                            : i18n.t("dashboard.noEmployeesScheduleDay")}
                        </p>
                      ) : (
                        <ul
                          className={cn(
                            "ps-1 mt-3",
                            displayRows.length > 4
                              ? "grid grid-cols-2 gap-3"
                              : "space-y-3",
                          )}
                        >
                          {displayRows.map((emp) => {
                            const tone = shiftTone(emp.shift);
                            const compact = displayRows.length > 4;
                            return (
                              <li
                                key={emp.id}
                                className={cn(
                                  "flex items-center justify-between gap-1 rounded-lg border-2 border-muted-foreground/30 bg-background shadow-sm",
                                  compact ? "px-2.5 py-2" : "flex-wrap gap-2 px-3 py-2.5",
                                  tone.row,
                                  emp.isSelf && "ring-2 ring-primary ring-offset-1",
                                  emp.isModified && "ring-2 ring-orange-500",
                                )}
                              >
                                <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                                  <Badge
                                    variant="outline"
                                    className={cn("shrink-0 text-[10px]", tone.badge)}
                                  >
                                    {emp.shiftLabel}
                                  </Badge>
                                  <span className={cn("font-medium truncate", compact ? "text-xs" : "text-sm")}>
                                    {emp.full_name}
                                  </span>
                                  {emp.isSelf && (
                                    <Badge variant="secondary" className="text-[10px] shrink-0">
                                      {i18n.t("dashboard.you")}
                                    </Badge>
                                  )}
                                  {emp.isModified && (
                                    <RefreshCw
                                      className="size-3 text-orange-600 shrink-0"
                                      aria-label="משמרת עודכנה לאחר פרסום"
                                    />
                                  )}
                                  {!compact && emp.note && (
                                    <span
                                      className={cn(
                                        "text-[10px] text-red-600 shrink-0 truncate max-w-[4.5rem] font-medium",
                                        emp.isNoteModified && "ring-2 ring-orange-500 rounded px-0.5",
                                      )}
                                      title={emp.note}
                                    >
                                      {emp.note}
                                    </span>
                                  )}
                                </div>
                                {emp.timeRange && !compact && (
                                  <span
                                    className={cn(
                                      "text-xs text-muted-foreground tabular-nums shrink-0 inline-flex items-center gap-1 rounded px-0.5",
                                      emp.isTimeModified && "ring-2 ring-orange-500",
                                    )}
                                    dir="ltr"
                                  >
                                    {emp.timeRange}
                                    {emp.isTimeModified && (
                                      <RefreshCw
                                        className="size-3 text-orange-600 shrink-0"
                                        aria-label="שעות עודכנו"
                                      />
                                    )}
                                  </span>
                                )}
                                {emp.timeRange && compact && (
                                  <span
                                    className="text-[10px] text-muted-foreground tabular-nums shrink-0"
                                    dir="ltr"
                                  >
                                    {emp.timeRange}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </>
                  )}
                </section>
              );
            })}

            {!departments.length && scope === "branch" && (
              <p className="p-6 text-sm text-muted-foreground text-center">
                {i18n.t("dashboard.noActiveDepts")}
              </p>
            )}

            {scope === "department" &&
              !hasAnyPublished &&
              departments.length > 0 &&
              !departments.some((d) => d.hasSavedAwaitingPublish) && (
                <p className="px-4 pb-4 text-sm text-muted-foreground border-t pt-4">
                  {i18n.t("dashboard.noApprovedPublishedWeek")}
                </p>
              )}
          </div>
    </>
  );

  if (embedded) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Card className={cn("card-elevated p-0 overflow-hidden", className)}>
      <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          {i18n.t("dashboard.dailySchedule")}
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {formatScheduleDayHe(displayWeekStart)} – {formatScheduleDayHe(displayWeekEnd)}
          </span>
          {showFullScheduleLink && (
            <Link to="/schedules" className="text-sm text-primary hover:underline">
              {i18n.t("dashboard.fullSchedule")}
            </Link>
          )}
        </div>
      </div>
      {body}
    </Card>
  );
}
