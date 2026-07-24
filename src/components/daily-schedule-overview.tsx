import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  type EmployeeLeaveFields,
} from "@/lib/employee-leave";
import {
  formatScheduleDayHe,
  getScheduleWeek,
  SCHEDULE_DAY_NAMES,
  type ScheduleShiftCode,
} from "@/lib/schedule-week";
import {
  buildChangeBaselineFromShiftRow,
  diffScheduleCellForViewer,
  type ScheduleChangeBaselineKind,
} from "@/lib/schedule-publish-diff";
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
  name: string;
  hasPublishedSchedule: boolean;
  scheduleId: string | null;
  hasSavedAwaitingPublish: boolean;
  changeBaselineKind: ScheduleChangeBaselineKind;
};

export type DailyScheduleEmployeeRow = {
  id: string;
  full_name: string;
  shift: ScheduleShiftCode;
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

const SHIFT_LABEL: Record<ScheduleShiftCode, string> = {
  morning: "בוקר",
  evening: "ערב",
  off: "חופש",
};

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
  def?: ShiftDef,
): string | null {
  if (shift === "off") return null;
  const start = normHm(row?.start_time) ?? normHm(def?.start_time);
  const end = normHm(row?.end_time) ?? normHm(def?.end_time);
  if (!start || !end) return null;
  return `${start}–${end}`;
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
  selfId?: string;
  includeSubmittedDiffWhenPublished: boolean;
}): DailyScheduleEmployeeRow[] {
  const {
    dept,
    employeesByDept,
    shifts,
    selectedDay,
    shiftFilter = null,
    shiftDefs,
    selfId,
    includeSubmittedDiffWhenPublished,
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
    const rawNote = raw.note ? String(raw.note).trim().slice(0, 10) : "";
    const submittedBaseline = buildChangeBaselineFromShiftRow(raw, "submitted", shiftDefs);
    const publishedBaseline = buildChangeBaselineFromShiftRow(raw, "published", shiftDefs);
    const start = normHm(raw.start_time) ?? normHm(def?.start_time);
    const end = normHm(raw.end_time) ?? normHm(def?.end_time);
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
      timeRange: resolveTimeRange(raw, shift, def),
      note: rawNote || null,
      isModified: isShiftModified,
      isNoteModified,
      isTimeModified,
      isSelf: !!selfId && stub.id === selfId,
    });
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
  className?: string;
};

export function DailyScheduleOverview({
  scope,
  departmentId,
  selfUserId,
  useCoworkersView = false,
  showFullScheduleLink = true,
  className,
}: DailyScheduleOverviewProps) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const getOverviewFn = useServerFn(getDailyScheduleOverview);
  const getDeptFlagsFn = useServerFn(getDepartmentWeekScheduleFlags);
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const { weekStart, weekEnd, weekDays } = useMemo(() => getScheduleWeek(), []);

  const permsQ = useQuery({
    enabled: !!profile?.id && !useCoworkersView,
    queryKey: ["my-perms", profile?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_create_schedule, can_approve_schedule, can_publish_schedule")
        .eq("user_id", profile!.id)
        .maybeSingle();
      return (
        data ?? {
          can_create_schedule: false,
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

  const todayIso = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      .toISOString()
      .slice(0, 10);
  }, []);

  const defaultDay = weekDays.includes(todayIso) ? todayIso : weekDays[0]!;
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [activeFilter, setActiveFilter] = useState<DeptShiftFilter | null>(null);

  useEffect(() => {
    setSelectedDay(defaultDay);
    setActiveFilter(null);
  }, [weekStart, defaultDay]);

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
    enabled: scope === "branch" || !!departmentId,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const deptFlagsQ = useQuery({
    queryKey: ["dept-schedule-flags", departmentId, weekStart],
    queryFn: () =>
      getDeptFlagsFn({
        data: { department_id: departmentId!, week_start: weekStart },
      }),
    enabled: scope === "department" && !!departmentId,
  });

  useEffect(() => {
    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
      qc.invalidateQueries({ queryKey: ["dashboard-shift-cards"] });
    };
    const ch = supabase
      .channel(`daily-schedule-ov-${scope}-${departmentId ?? "branch"}-${weekStart}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, invalidate)
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, invalidate)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_notifications" },
        invalidate,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [scope, departmentId, weekStart, qc]);

  const departments = useMemo(() => {
    const base = (q.data?.departments ?? []) as DeptScheduleMeta[];
    if (scope !== "department" || !deptFlagsQ.data) return base;
    return base.map((d) => ({
      ...d,
      hasSavedAwaitingPublish: deptFlagsQ.data!.hasSavedAwaitingPublish,
    }));
  }, [q.data?.departments, scope, deptFlagsQ.data]);

  const employeesByDept = (q.data?.employeesByDept ?? {}) as Record<string, DeptEmployee[]>;
  const shifts = (q.data?.shifts ?? []) as ShiftRow[];

  const deptCounts = useMemo(() => {
    const out: Record<string, Record<ScheduleShiftCode, number>> = {};
    for (const dept of departments) {
      out[dept.id] = computeDeptDayCounts(dept, employeesByDept, shifts, selectedDay);
    }
    return out;
  }, [departments, employeesByDept, shifts, selectedDay]);

  const selectedDayIndex = weekDays.indexOf(selectedDay);
  const selectedDayName =
    selectedDayIndex >= 0 ? SCHEDULE_DAY_NAMES[selectedDayIndex] : "";

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
        label: "בוקר",
        activeClass: "ring-2 ring-amber-500 border-amber-400 bg-amber-50",
        idleClass: "border-amber-200 bg-amber-50/40 hover:bg-amber-50",
        icon: Sun,
      };
    }
    if (code === "evening") {
      return {
        badge: "bg-sky-100 text-sky-900 border-sky-300",
        row: "bg-sky-50/60 border-sky-100",
        label: "ערב",
        activeClass: "ring-2 ring-sky-500 border-sky-400 bg-sky-50",
        idleClass: "border-sky-200 bg-sky-50/40 hover:bg-sky-50",
        icon: Moon,
      };
    }
    return {
      badge: "bg-emerald-100 text-emerald-900 border-emerald-300",
      row: "bg-emerald-50/60 border-emerald-100",
      label: "חופש",
      activeClass: "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50",
      idleClass: "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50",
      icon: Plane,
    };
  };

  const shiftCards: ScheduleShiftCode[] = ["morning", "evening", "off"];
  const hasAnyPublished = departments.some((d) => d.hasPublishedSchedule);

  return (
    <Card className={cn("card-elevated p-0 overflow-hidden", className)}>
      <div className="px-4 pt-4 pb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-base flex items-center gap-2">
          <CalendarDays className="size-5 text-primary" />
          סידור עבודה יומי
        </h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {formatScheduleDayHe(weekStart)} – {formatScheduleDayHe(weekEnd)}
          </span>
          {showFullScheduleLink && (
            <Link to="/schedules" className="text-sm text-primary hover:underline">
              לסידור המלא ←
            </Link>
          )}
        </div>
      </div>

      {q.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : q.isError ? (
        <p className="p-6 text-sm text-destructive text-center">
          {(q.error as Error)?.message ?? "שגיאה בטעינת הסידור"}
        </p>
      ) : (
        <>
          <div className="px-3 pb-3 overflow-x-auto">
            <div className="flex gap-1 min-w-max">
              {weekDays.map((day, i) => {
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
                    <span className="text-xs font-semibold">{SCHEDULE_DAY_NAMES[i]}</span>
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
              יום {selectedDayName} {formatScheduleDayHe(selectedDay)}
              {activeFilter && (
                <span className="ms-2">
                  · מציג: {SHIFT_LABEL[activeFilter.shift]} —{" "}
                  {departments.find((d) => d.id === activeFilter.deptId)?.name}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs gap-1 ms-1"
                    onClick={() => setActiveFilter(null)}
                  >
                    <X className="size-3" />
                    ביטול
                  </Button>
                </span>
              )}
            </div>
          )}

          <div className="divide-y border-t max-h-[min(60vh,520px)] overflow-y-auto">
            {departments.map((dept) => {
              const counts = deptCounts[dept.id] ?? { morning: 0, evening: 0, off: 0 };
              const isFilterActive =
                activeFilter?.deptId === dept.id ? activeFilter.shift : null;
              const displayRows = buildDepartmentEmployeeRows({
                dept,
                employeesByDept,
                shifts,
                selectedDay,
                shiftFilter: isFilterActive,
                shiftDefs: shiftDefsQ.map,
                selfId: selfUserId,
                includeSubmittedDiffWhenPublished,
              });

              return (
                <section key={dept.id} className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Building2 className="size-4 text-muted-foreground shrink-0" />
                    <h3 className="font-semibold text-sm">{dept.name}</h3>
                  </div>

                  {!dept.scheduleId ? (
                    dept.hasSavedAwaitingPublish ? (
                      <Alert className="ms-6 border-amber-200 bg-amber-50/80">
                        <AlertDescription className="text-sm text-amber-900">
                          יש סידור עבודה למחלקה זו שמור ובהמתנה לפרסום.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <p className="text-sm text-muted-foreground ps-6">אין סידור שבועי שפורסם</p>
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
                              onClick={() => toggleDeptFilter(dept.id, code)}
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
                                  פעיל ✓
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {displayRows.length === 0 ? (
                        <p className="text-sm text-muted-foreground ps-6">
                          {isFilterActive != null
                            ? `אין עובדים ב${SHIFT_LABEL[isFilterActive]} ליום זה`
                            : "אין עובדים בסידור ליום זה"}
                        </p>
                      ) : (
                        <ul className="space-y-1.5 ps-1 mt-2">
                          {displayRows.map((emp) => {
                            const tone = shiftTone(emp.shift);
                            return (
                              <li
                                key={emp.id}
                                className={cn(
                                  "flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5",
                                  tone.row,
                                  emp.isSelf && "ring-2 ring-primary ring-offset-1",
                                  emp.isModified && "ring-2 ring-orange-500",
                                )}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <Badge
                                    variant="outline"
                                    className={cn("shrink-0 text-[10px]", tone.badge)}
                                  >
                                    {tone.label}
                                  </Badge>
                                  <span className="font-medium text-sm truncate">
                                    {emp.full_name}
                                  </span>
                                  {emp.isSelf && (
                                    <Badge variant="secondary" className="text-[10px] shrink-0">
                                      את/ה
                                    </Badge>
                                  )}
                                  {emp.isModified && (
                                    <RefreshCw
                                      className="size-3 text-orange-600 shrink-0"
                                      aria-label="משמרת עודכנה לאחר פרסום"
                                    />
                                  )}
                                  {emp.note && (
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
                                {emp.timeRange && (
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
                אין מחלקות פעילות להצגה.
              </p>
            )}

            {scope === "department" &&
              !hasAnyPublished &&
              departments.length > 0 &&
              !departments.some((d) => d.hasSavedAwaitingPublish) && (
                <p className="px-4 pb-4 text-sm text-muted-foreground border-t pt-4">
                  טרם פורסם סידור עבודה מאושר לשבוע זה.
                </p>
              )}
          </div>
        </>
      )}
    </Card>
  );
}
