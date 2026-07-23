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
  resolveScheduleChangeBaselineKind,
  type ScheduleChangeBaselineKind,
} from "@/lib/schedule-publish-diff";
import { canViewScheduleContent, type ScheduleViewerCaps } from "@/lib/schedule-visibility";
import { resolveScheduleManagerCaps } from "@/lib/schedule-manager-caps";
import { useAuth } from "@/lib/use-auth";
import { useShiftDefinitions, type ShiftDef } from "@/lib/use-shift-definitions";
import { cn } from "@/lib/utils";
import { getDepartmentWeekScheduleFlags } from "@/lib/schedules.functions";

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

type DeptScheduleRow = {
  id: string;
  department_id: string;
  status: string;
  published_at: string | null;
  submitted_at: string | null;
  created_by: string | null;
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

export type DailyScheduleDepartmentBlock = {
  id: string;
  name: string;
  state: "no_weekly_schedule" | "no_day_schedule" | "has_rows";
  employees: DailyScheduleEmployeeRow[];
  hasSavedAwaitingPublish: boolean;
};

type DailySchedulePayload = {
  departments: DeptScheduleMeta[];
  employeesByDept: Record<string, DeptEmployee[]>;
  shifts: ShiftRow[];
};

const SHIFT_ORDER: Record<ScheduleShiftCode, number> = {
  morning: 0,
  evening: 1,
  off: 2,
};

const FILTER_LABEL: Record<ScheduleShiftCode, string> = {
  morning: "משמרת בוקר בלבד",
  evening: "משמרת ערב בלבד",
  off: "חופש בלבד",
};

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

async function fetchBranchDepartments(): Promise<DeptScheduleMeta[]> {
  const { data, error } = await supabase
    .from("departments")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    hasPublishedSchedule: false,
    scheduleId: null,
    hasSavedAwaitingPublish: false,
    changeBaselineKind: null,
  }));
}

async function fetchDepartmentEmployees(
  departmentId: string,
  useCoworkersView: boolean,
): Promise<DeptEmployee[]> {
  if (useCoworkersView) {
    const { data, error } = await (supabase as any)
      .from("department_coworkers")
      .select(
        "id, full_name, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date",
      )
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("full_name");
    if (error) throw error;
    return (data ?? []) as DeptEmployee[];
  }

  const [{ data, error }, { data: dept }] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id, full_name, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date",
      )
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .order("full_name"),
    supabase.from("departments").select("manager_id").eq("id", departmentId).maybeSingle(),
  ]);
  if (error) throw error;
  const rows = [...(data ?? [])] as DeptEmployee[];
  if (dept?.manager_id && !rows.some((e) => e.id === dept.manager_id)) {
    const { data: mgr } = await supabase
      .from("profiles")
      .select(
        "id, full_name, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date",
      )
      .eq("id", dept.manager_id)
      .eq("is_active", true)
      .maybeSingle();
    if (mgr) rows.push(mgr as DeptEmployee);
  }
  rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
  return rows;
}

async function fetchDailySchedulePayload(
  scope: DailyScheduleScope,
  departmentId: string | undefined,
  weekStart: string,
  weekEnd: string,
  useCoworkersView: boolean,
  viewerCaps?: ScheduleViewerCaps | null,
  managedDeptIds?: string[],
): Promise<DailySchedulePayload> {
  let departments: DeptScheduleMeta[];
  if (scope === "department") {
    if (!departmentId) {
      return { departments: [], employeesByDept: {}, shifts: [] };
    }
    const { data: dept, error } = await supabase
      .from("departments")
      .select("id, name")
      .eq("id", departmentId)
      .maybeSingle();
    if (error) throw error;
    departments = dept
      ? [{
          id: dept.id,
          name: dept.name,
          hasPublishedSchedule: false,
          scheduleId: null,
          hasSavedAwaitingPublish: false,
          changeBaselineKind: null,
        }]
      : [];
  } else {
    departments = await fetchBranchDepartments();
  }

  const deptIds = departments.map((d) => d.id);
  if (!deptIds.length) {
    return { departments: [], employeesByDept: {}, shifts: [] };
  }

  const { data: scheds, error: schedErr } = await supabase
    .from("schedules")
    .select("id, department_id, status, published_at, submitted_at, created_by, week_start, week_end")
    .in("department_id", deptIds)
    .lte("week_start", weekEnd)
    .gte("week_end", weekStart);
  if (schedErr) throw schedErr;

  const schedByDept = new Map<string, DeptScheduleRow>();
  const candidatesByDept = new Map<string, DeptScheduleRow[]>();
  for (const s of (scheds ?? []) as DeptScheduleRow[]) {
    const list = candidatesByDept.get(s.department_id) ?? [];
    list.push(s);
    candidatesByDept.set(s.department_id, list);
  }

  for (const [deptId, candidates] of candidatesByDept) {
    if (useCoworkersView) {
      const published = candidates.find(
        (s) => s.status === "approved" && s.published_at,
      );
      if (published) schedByDept.set(deptId, published);
      continue;
    }
    const visible = candidates.filter((s) =>
      viewerCaps
        ? canViewScheduleContent(
            {
              status: s.status,
              published_at: s.published_at,
              submitted_at: s.submitted_at,
              created_by: s.created_by,
              department_id: s.department_id,
            },
            viewerCaps,
            managedDeptIds,
          )
        : false,
    );
    if (!visible.length) continue;
    const picked =
      visible.find((s) => s.status === "approved" && s.published_at) ?? visible[0]!;
    schedByDept.set(deptId, picked);
  }

  departments = departments.map((d) => {
    const sched = schedByDept.get(d.id);
    const changeBaselineKind = sched
      ? resolveScheduleChangeBaselineKind({
          status: sched.status,
          published_at: sched.published_at,
          submitted_at: sched.submitted_at,
        })
      : null;
    return {
      ...d,
      hasPublishedSchedule: !!(sched?.status === "approved" && sched?.published_at),
      scheduleId: sched?.id ?? null,
      hasSavedAwaitingPublish: false,
      changeBaselineKind,
    };
  });

  const scheduleIds = [...schedByDept.values()].map((s) => s.id);
  let shifts: ShiftRow[] = [];
  if (scheduleIds.length) {
    const { data: shiftRows, error: shiftErr } = await supabase
      .from("schedule_shifts")
      .select(
        "employee_id, day_date, shift, published_shift, published_note, published_start_time, published_end_time, submitted_shift, submitted_note, submitted_start_time, submitted_end_time, start_time, end_time, note, schedule_id",
      )
      .in("schedule_id", scheduleIds)
      .gte("day_date", weekStart)
      .lte("day_date", weekEnd);
    if (shiftErr) throw shiftErr;
    shifts = (shiftRows ?? []) as ShiftRow[];
  }

  const employeesByDept: Record<string, DeptEmployee[]> = {};
  await Promise.all(
    departments.map(async (d) => {
      employeesByDept[d.id] = await fetchDepartmentEmployees(d.id, useCoworkersView);
    }),
  );

  return { departments, employeesByDept, shifts };
}

function buildDepartmentBlocks(args: {
  departments: DeptScheduleMeta[];
  employeesByDept: Record<string, DeptEmployee[]>;
  shifts: ShiftRow[];
  selectedDay: string;
  shiftDefs: Map<string, ShiftDef>;
  selfId?: string;
  shiftFilter: ScheduleShiftCode | null;
  includeSubmittedDiffWhenPublished: boolean;
}): DailyScheduleDepartmentBlock[] {
  const {
    departments,
    employeesByDept,
    shifts,
    selectedDay,
    shiftDefs,
    selfId,
    shiftFilter,
    includeSubmittedDiffWhenPublished,
  } = args;

  const shiftsBySchedEmpDay = new Map<string, ShiftRow>();
  for (const s of shifts) {
    shiftsBySchedEmpDay.set(`${s.schedule_id}|${s.employee_id}|${s.day_date}`, s);
  }

  return departments.map((dept) => {
    if (!dept.scheduleId) {
      return {
        id: dept.id,
        name: dept.name,
        state: "no_weekly_schedule" as const,
        employees: [],
        hasSavedAwaitingPublish: dept.hasSavedAwaitingPublish,
      };
    }

    const emps = (employeesByDept[dept.id] ?? []).filter((e) => !e.excluded_from_schedule);
    const hasDayShiftRows = shifts.some(
      (s) => s.day_date === selectedDay && emps.some((e) => e.id === s.employee_id),
    );

    const rows: DailyScheduleEmployeeRow[] = emps.map((emp) => {
      const raw = shiftsBySchedEmpDay.get(`${dept.scheduleId}|${emp.id}|${selectedDay}`);
      const shift = normalizeShift(emp, selectedDay, raw?.shift);
      const def = shiftDefs.get(shift);
      const rawNote = raw?.note ? String(raw.note).trim().slice(0, 10) : "";
      const submittedBaseline = raw
        ? buildChangeBaselineFromShiftRow(raw, "submitted", shiftDefs)
        : null;
      const publishedBaseline = raw
        ? buildChangeBaselineFromShiftRow(raw, "published", shiftDefs)
        : null;
      const start = normHm(raw?.start_time) ?? normHm(def?.start_time);
      const end = normHm(raw?.end_time) ?? normHm(def?.end_time);
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
      return {
        id: emp.id,
        full_name: emp.full_name,
        shift,
        timeRange: resolveTimeRange(raw, shift, def),
        note: rawNote || null,
        isModified: isShiftModified,
        isNoteModified,
        isTimeModified,
        isSelf: !!selfId && emp.id === selfId,
      };
    });

    rows.sort((a, b) => {
      const so = SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift];
      if (so !== 0) return so;
      return a.full_name.localeCompare(b.full_name, "he");
    });

    const filtered = shiftFilter ? rows.filter((r) => r.shift === shiftFilter) : rows;

    let state: DailyScheduleDepartmentBlock["state"] = "has_rows";
    if (!hasDayShiftRows && rows.every((r) => r.shift === "off")) {
      state = "no_day_schedule";
    }

    return {
      id: dept.id,
      name: dept.name,
      state,
      employees: filtered,
      hasSavedAwaitingPublish: dept.hasSavedAwaitingPublish,
    };
  });
}

export type DailyScheduleOverviewProps = {
  scope: DailyScheduleScope;
  departmentId?: string | null;
  selfUserId?: string;
  useCoworkersView?: boolean;
  showFullScheduleLink?: boolean;
  className?: string;
};

function buildViewerCapsFromProfile(
  profile: {
    id: string;
    roles: string[];
    department_id: string | null;
  },
  perms: {
    can_create_schedule: boolean;
    can_approve_schedule: boolean;
    can_publish_schedule: boolean;
    can_manage_schedule?: boolean;
  },
): ScheduleViewerCaps {
  const caps = resolveScheduleManagerCaps(profile.roles, perms);
  return {
    userId: profile.id,
    isMainAdmin: caps.isMainAdmin,
    isBranchMgr: caps.isBranchMgr,
    isDeptMgr: caps.isDeptMgr,
    canCreate: caps.canCreate,
    canApprove: caps.canApprove,
    canPublishDirect: caps.canPublishDirect,
    departmentId: profile.department_id,
  };
}

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

  const viewerCaps = useMemo(() => {
    if (useCoworkersView || !profile) return null;
    return buildViewerCapsFromProfile(profile, permsQ.data ?? {
      can_create_schedule: false,
      can_approve_schedule: false,
      can_publish_schedule: false,
    });
  }, [useCoworkersView, profile, permsQ.data]);

  const managedDeptIds = useMemo(() => {
    if (!viewerCaps?.isDeptMgr || viewerCaps.isMainAdmin || viewerCaps.isBranchMgr) {
      return undefined;
    }
    const ids = new Set<string>();
    if (viewerCaps.departmentId) ids.add(viewerCaps.departmentId);
    return [...ids];
  }, [viewerCaps]);

  const todayIso = useMemo(() => {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
      .toISOString()
      .slice(0, 10);
  }, []);

  const defaultDay = weekDays.includes(todayIso) ? todayIso : weekDays[0]!;
  const [selectedDay, setSelectedDay] = useState(defaultDay);
  const [shiftFilter, setShiftFilter] = useState<ScheduleShiftCode | null>(null);

  useEffect(() => {
    setSelectedDay(defaultDay);
    setShiftFilter(null);
  }, [weekStart, defaultDay]);

  const queryKey = [
    "daily-schedule-overview",
    scope,
    departmentId ?? "all",
    weekStart,
    useCoworkersView,
    viewerCaps?.userId ?? "anon",
  ] as const;

  const q = useQuery({
    queryKey,
    queryFn: () =>
      fetchDailySchedulePayload(
        scope,
        departmentId ?? undefined,
        weekStart,
        weekEnd,
        useCoworkersView,
        viewerCaps,
        managedDeptIds,
      ),
    enabled:
      (scope === "branch" || !!departmentId) &&
      (useCoworkersView || (!!viewerCaps && !permsQ.isLoading)),
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
    const ch = supabase
      .channel(`daily-schedule-ov-${scope}-${departmentId ?? "branch"}-${weekStart}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
        qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [scope, departmentId, weekStart, qc]);

  const departments = useMemo(() => {
    const base = q.data?.departments ?? [];
    if (scope !== "department" || !deptFlagsQ.data) return base;
    return base.map((d) => ({
      ...d,
      hasSavedAwaitingPublish: deptFlagsQ.data!.hasSavedAwaitingPublish,
    }));
  }, [q.data?.departments, scope, deptFlagsQ.data]);
  const employeesByDept = q.data?.employeesByDept ?? {};
  const shifts = q.data?.shifts ?? [];

  const dayCounts = useMemo(() => {
    const byDay: Record<string, Record<ScheduleShiftCode, number>> = {};
    for (const day of weekDays) {
      byDay[day] = { morning: 0, evening: 0, off: 0 };
    }
    for (const dept of departments) {
      if (!dept.scheduleId) continue;
      const emps = (employeesByDept[dept.id] ?? []).filter((e) => !e.excluded_from_schedule);
      for (const emp of emps) {
        if (!isCountedInDailySummary(emp)) continue;
        for (const day of weekDays) {
          const raw = shifts.find((s) => s.day_date === day && s.employee_id === emp.id);
          const shift = normalizeShift(emp, day, raw?.shift);
          byDay[day]![shift] += 1;
        }
      }
    }
    return byDay;
  }, [departments, employeesByDept, shifts, weekDays]);

  const selectedCounts = dayCounts[selectedDay] ?? { morning: 0, evening: 0, off: 0 };

  const includeSubmittedDiffWhenPublished = useMemo(() => {
    if (useCoworkersView || !viewerCaps) return false;
    return (
      viewerCaps.isMainAdmin ||
      viewerCaps.isBranchMgr ||
      viewerCaps.isDeptMgr ||
      viewerCaps.canApprove ||
      viewerCaps.canPublishDirect
    );
  }, [useCoworkersView, viewerCaps]);

  const departmentBlocks = useMemo(
    () =>
      buildDepartmentBlocks({
        departments,
        employeesByDept,
        shifts,
        selectedDay,
        shiftDefs: shiftDefsQ.map,
        selfId: selfUserId,
        shiftFilter,
        includeSubmittedDiffWhenPublished,
      }),
    [
      departments,
      employeesByDept,
      shifts,
      selectedDay,
      shiftDefsQ.map,
      selfUserId,
      shiftFilter,
      includeSubmittedDiffWhenPublished,
    ],
  );

  const selectedDayIndex = weekDays.indexOf(selectedDay);
  const selectedDayName =
    selectedDayIndex >= 0 ? SCHEDULE_DAY_NAMES[selectedDayIndex] : "";

  const toggleFilter = (code: ScheduleShiftCode) => {
    setShiftFilter((prev) => (prev === code ? null : code));
  };

  const shiftTone = (code: ScheduleShiftCode) => {
    if (code === "morning") {
      return {
        badge: "bg-amber-100 text-amber-900 border-amber-300",
        row: "bg-amber-50/60 border-amber-100",
        label: "בוקר",
      };
    }
    if (code === "evening") {
      return {
        badge: "bg-sky-100 text-sky-900 border-sky-300",
        row: "bg-sky-50/60 border-sky-100",
        label: "ערב",
      };
    }
    return {
      badge: "bg-emerald-100 text-emerald-900 border-emerald-300",
      row: "bg-emerald-50/60 border-emerald-100",
      label: "חופש",
    };
  };

  const filterCards: {
    code: ScheduleShiftCode;
    label: string;
    icon: typeof Sun;
    count: number;
    activeClass: string;
    idleClass: string;
  }[] = [
    {
      code: "morning",
      label: "בוקר",
      icon: Sun,
      count: selectedCounts.morning,
      activeClass: "ring-2 ring-amber-500 border-amber-400 bg-amber-50",
      idleClass: "border-amber-200 bg-amber-50/40 hover:bg-amber-50",
    },
    {
      code: "evening",
      label: "ערב",
      icon: Moon,
      count: selectedCounts.evening,
      activeClass: "ring-2 ring-sky-500 border-sky-400 bg-sky-50",
      idleClass: "border-sky-200 bg-sky-50/40 hover:bg-sky-50",
    },
    {
      code: "off",
      label: "חופש",
      icon: Plane,
      count: selectedCounts.off,
      activeClass: "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50",
      idleClass: "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50",
    },
  ];

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
                      setShiftFilter(null);
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

          <div className="px-4 pb-2">
            <div className="grid grid-cols-3 gap-2">
              {filterCards.map(({ code, label, icon: Icon, count, activeClass, idleClass }) => {
                const active = shiftFilter === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleFilter(code)}
                    className={cn(
                      "rounded-lg border p-2 text-center transition-all",
                      active ? activeClass : idleClass,
                    )}
                  >
                    <div className="flex items-center justify-center gap-1 text-xs font-medium">
                      <Icon className="size-3.5" />
                      {label}
                    </div>
                    <div className="text-lg font-bold tabular-nums mt-0.5">{count}</div>
                    {active && (
                      <div className="text-[10px] text-primary mt-0.5 font-medium">פעיל ✓</div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
              <span>
                מציג:{" "}
                <span className="font-medium text-foreground">
                  {shiftFilter ? FILTER_LABEL[shiftFilter] : "כל המשמרות"}
                </span>
              </span>
              {selectedDayName && (
                <span>
                  · יום {selectedDayName} {formatScheduleDayHe(selectedDay)}
                </span>
              )}
              {shiftFilter && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs gap-1"
                  onClick={() => setShiftFilter(null)}
                >
                  <X className="size-3" />
                  ביטול סינון
                </Button>
              )}
            </div>
          </div>

          <div className="divide-y border-t max-h-[min(60vh,520px)] overflow-y-auto">
            {departmentBlocks.map((dept) => (
              <section key={dept.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Building2 className="size-4 text-muted-foreground shrink-0" />
                  <h3 className="font-semibold text-sm">{dept.name}</h3>
                  {dept.state === "has_rows" && dept.employees.length > 0 && (
                    <span className="text-xs text-muted-foreground">({dept.employees.length})</span>
                  )}
                </div>

                {dept.state === "no_weekly_schedule" ? (
                  dept.hasSavedAwaitingPublish ? (
                    <Alert className="ms-6 border-amber-200 bg-amber-50/80">
                      <AlertDescription className="text-sm text-amber-900">
                        יש סידור עבודה למחלקה זו שמור ובהמתנה לפרסום.
                      </AlertDescription>
                    </Alert>
                  ) : (
                    <p className="text-sm text-muted-foreground ps-6">אין סידור שבועי שפורסם</p>
                  )
                ) : dept.employees.length === 0 ? (
                  <p className="text-sm text-muted-foreground ps-6">
                    {shiftFilter
                      ? "אין עובדים במשמרת זו ליום זה"
                      : dept.state === "no_day_schedule"
                        ? "אין סידור עבודה ליום זה"
                        : "אין עובדים במשמרת זו ליום זה"}
                  </p>
                ) : (
                  <ul className="space-y-1.5 ps-1">
                    {dept.employees.map((emp) => {
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
                            <Badge variant="outline" className={cn("shrink-0 text-[10px]", tone.badge)}>
                              {tone.label}
                            </Badge>
                            <span className="font-medium text-sm truncate">{emp.full_name}</span>
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
              </section>
            ))}

            {!departmentBlocks.length && scope === "branch" && (
              <p className="p-6 text-sm text-muted-foreground text-center">
                אין מחלקות פעילות להצגה.
              </p>
            )}

            {scope === "department" &&
              !hasAnyPublished &&
              departmentBlocks.length > 0 &&
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
