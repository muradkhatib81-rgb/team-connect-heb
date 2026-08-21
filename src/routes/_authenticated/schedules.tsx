import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import i18n from "@/i18n";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Copy,
  Send,
  CheckCircle2,
  ChevronDown,
  
  Loader2,
  Save,
  AlertTriangle,
  Trash2,
  RefreshCw,
  UserX,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import {
  createOrGetSchedule,
  saveScheduleShifts,
  submitSchedule,
  approveSchedule,
  publishSchedule,
  getSchedulesForViewer,
  getDepartmentWeekScheduleFlags,
  copyPreviousWeek,
  deleteSchedule,
  publishAllWeekSchedules,
  setEmployeeScheduleExclusion,
} from "@/lib/schedules.functions";
import { formatHeDate, formatHeDateTime } from "@/lib/date-format";
import { isEmployeeOnLeaveOnDate, effectiveScheduleShift, leaveOffLabel } from "@/lib/employee-leave";
import {
  buildChangeBaselineMap,
  diffScheduleCellForViewer,
  resolveScheduleChangeBaselineKind,
} from "@/lib/schedule-publish-diff";
import {
  canViewScheduleContent,
  isSavedScheduleAwaitingPublish,
  type ScheduleViewerCaps,
} from "@/lib/schedule-visibility";
import {
  canEditScheduleTimes as resolveCanEditScheduleTimes,
  resolveScheduleManagerCaps,
} from "@/lib/schedule-manager-caps";
import { groupSchedulesByPeriod, groupSchedulesByPeriodLimitedPerDept } from "@/lib/schedule-period-groups";
import {
  getLatestPublishedScheduleIdForDepartment,
  isDeptWideLatestPublished,
  isSupersededPublishedSchedule,
  latestPublishedIdByDepartment,
} from "@/lib/schedule-superseded";
import { useShiftDefinitions } from "@/lib/use-shift-definitions";
import { useCompanySettings } from "@/lib/use-company-settings";
import { useSchedulePeriodConfig } from "@/lib/use-schedule-period-config";
import {
  addDaysISO,
  buildPeriodDays,
  filterPeriodCalendarDays,
  getConfiguredWeekDows,
  getPeriodEnd,
  getPeriodStart,
  DEFAULT_PERIOD_CONFIG,
  shiftPeriodStart,
  utcDowFromSaturday,
  type BranchPeriodConfig,
  type ScheduleDow,
} from "@/lib/schedule-period-config";
import { scheduleDayLabelForDate } from "@/lib/schedule-week";
import { formatShiftTimeRange } from "@/lib/shift-hours";

function filterDaysByPeriodConfig(calendarDays: string[], config: BranchPeriodConfig): string[] {
  if (config.schedule_type === "monthly") {
    return filterPeriodCalendarDays(calendarDays, config);
  }
  const allowed = new Set(getConfiguredWeekDows(config.week_start_dow, config.week_end_dow));
  return calendarDays.filter((iso) => allowed.has(utcDowFromSaturday(iso) as ScheduleDow));
}

type CellTimeOverride = { start?: string | null; end?: string | null };

function hmFromValue(value: string | null | undefined): string | null {
  return value ? String(value).slice(0, 5) : null;
}

function resolveEffectiveCellTimes(
  cellTimes: CellTimeOverride | undefined,
  defStart: string | null,
  defEnd: string | null,
): { start: string | null; end: string | null } {
  return {
    start: cellTimes?.start !== undefined ? cellTimes.start : defStart,
    end: cellTimes?.end !== undefined ? cellTimes.end : defEnd,
  };
}
import { Time24Input } from "@/components/ui/time24-input";

import { SCHEDULE_NOTE_MAX, trimScheduleNote } from "@/lib/schedule-note";

type SchedulesView = "pending" | "editor" | "approved" | "saved";
type SchedulesSearch = { dept?: string; week?: string; view?: SchedulesView };
type SavedScheduleListItem = {
  schedule_id: string;
  department_id: string;
  week_start: string;
  week_end: string;
  status: string;
  published_at: string | null;
  updated_at: string | null;
};
type SummaryShiftPick = {
  day: string;
  dayLabel: string;
  shiftName: string;
  members: { employeeId: string; departmentId: string }[];
};
export const Route = createFileRoute("/_authenticated/schedules")({
  component: SchedulesPage,
  validateSearch: (s: Record<string, unknown>): SchedulesSearch => ({
    dept: typeof s.dept === "string" ? s.dept : undefined,
    week: typeof s.week === "string" ? s.week : undefined,
    view:
      s.view === "pending" || s.view === "editor" || s.view === "approved" || s.view === "saved"
        ? s.view
        : undefined,
  }),

});

// Shift codes are dynamic — labels and colors come from public.shift_definitions.
type Shift = string;
const STATUS_LABEL: Record<string, string> = {
  draft: i18n.t("schedules.statusDraft"),
  pending_approval: i18n.t("schedules.statusPending"),
  approved: i18n.t("schedules.statusApproved"),
  rejected: i18n.t("schedules.statusRejected"),
};
function getStatusLabel(status: string): string {
  const key: Record<string, string> = {
    draft: "schedules.statusDraft",
    pending_approval: "schedules.statusPending",
    approved: "schedules.statusApproved",
    rejected: "schedules.statusRejected",
  };
  return i18n.t(key[status] ?? "schedules.unknown");
}
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
};
function getDayNames(): string[] {
  return [
    i18n.t("schedules.dayShort.0"),
    i18n.t("schedules.dayShort.1"),
    i18n.t("schedules.dayShort.2"),
    i18n.t("schedules.dayShort.3"),
    i18n.t("schedules.dayShort.4"),
    i18n.t("schedules.dayShort.5"),
    i18n.t("schedules.dayShort.6"),
  ];
}
function getFullDayNames(): string[] {
  return [
    i18n.t("schedules.dayFull.0"),
    i18n.t("schedules.dayFull.1"),
    i18n.t("schedules.dayFull.2"),
    i18n.t("schedules.dayFull.3"),
    i18n.t("schedules.dayFull.4"),
    i18n.t("schedules.dayFull.5"),
    i18n.t("schedules.dayFull.6"),
  ];
}

type SchedulePersonMeta = {
  id: string;
  full_name: string;
  job_title: string | null;
  role_label: string | null;
  at: string | null;
} | null;

function SchedulePersonMetaRow({
  label,
  person,
  className = "text-muted-foreground",
  fallback = "לא ידוע",
}: {
  label: string;
  person: SchedulePersonMeta;
  className?: string;
  fallback?: string;
}) {
  const name = person?.full_name?.trim() || fallback;
  const role = person?.role_label?.trim() || fallback;
  const at = person?.at ? formatHeDateTime(person.at) : fallback;
  return (
    <div className={`text-xs flex flex-wrap gap-x-2 gap-y-0.5 ${className}`}>
      <span>{label}</span>
      <span className="font-medium text-foreground">👤 {name}</span>
      <span>· 💼 {role}</span>
      {person?.job_title && <span>({person.job_title})</span>}
      <span>· 📅🕒 {at}</span>
    </div>
  );
}

function getPeriodStartFromDate(date: Date, config: BranchPeriodConfig): string {
  const refIso = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  )
    .toISOString()
    .slice(0, 10);
  return getPeriodStart(refIso, config);
}

function buildDaysBetween(startIso: string, endIso: string): string[] {
  const days: string[] = [];
  let iso = startIso;
  while (iso <= endIso) {
    days.push(iso);
    iso = addDaysISO(iso, 1);
  }
  return days;
}

function SchedulesPage() {
  const { data: me, isLoading: meLoading } = useAuth();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const companyQ = useCompanySettings();
  const periodConfigQ = useSchedulePeriodConfig();
  const periodConfig = periodConfigQ.data ?? DEFAULT_PERIOD_CONFIG;
  const shiftDefsQ = useShiftDefinitions();
  const activeShifts = shiftDefsQ.list.filter((s) => s.is_active);
  const shiftLabel = (code: string | null | undefined, fallback = "—") =>
    code ? (shiftDefsQ.map.get(code)?.name ?? code) : fallback;
  const shiftColor = (code: string | null | undefined) =>
    code ? shiftDefsQ.map.get(code)?.color : undefined;
  const shiftStyle = (code: string | null | undefined): React.CSSProperties => {
    const c = shiftColor(code);
    if (!c) return {};
    return { backgroundColor: `${c}22`, color: c, borderColor: `${c}66` };
  };

  const permsQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["my-perms", me?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select(
          "can_view_schedule, can_create_schedule, can_edit_schedule, can_approve_schedule, can_publish_schedule, can_manage_schedule",
        )
        .eq("user_id", me!.id)
        .maybeSingle();
      return (
        data ?? {
          can_view_schedule: false,
          can_create_schedule: false,
          can_edit_schedule: false,
          can_approve_schedule: false,
          can_publish_schedule: false,
          can_manage_schedule: false,
        }
      );
    },
  });

  const managerCaps = useMemo(
    () => resolveScheduleManagerCaps(me?.roles ?? [], permsQ.data),
    [me?.roles, permsQ.data],
  );
  const {
    isMainAdmin,
    isBranchManager,
    isAssistantManager,
    isDeptMgr,
    isBranchMgr,
    isDeptHeadOnly,
    canView,
    canCreate,
    canEdit,
    canApprove,
    canPublishDirect,
  } = managerCaps;
  const canViewBranchSchedules =
    isBranchMgr || (isAssistantManager && canView);
  const isEmployee = !isMainAdmin && !canViewBranchSchedules && !isDeptMgr;

  const canEditScheduleTimes = resolveCanEditScheduleTimes(managerCaps);
  /** Exclude-from-schedule: branch/platform operators only — not dept-head-only. */
  const canManageScheduleExclusion = canEditScheduleTimes;
  /** Dept heads submit for approval only; no standalone draft save. */
  const canSaveScheduleDraft = !isDeptHeadOnly;
  const canSeeScheduleQueues = canApprove || canPublishDirect;
  const canViewPrePublishSummary = canViewBranchSchedules;

  const myDeptId = me?.department_id ?? null;

  const scheduleViewerCaps = useMemo((): ScheduleViewerCaps | null => {
    if (!me?.id) return null;
    return {
      userId: me.id,
      isMainAdmin,
      isBranchMgr,
      isDeptMgr,
      canView,
      canCreate,
      canEdit,
      canApprove,
      canPublishDirect,
      departmentId: myDeptId,
    };
  }, [
    me?.id,
    isMainAdmin,
    isBranchMgr,
    isDeptMgr,
    canView,
    canCreate,
    canEdit,
    canApprove,
    canPublishDirect,
    myDeptId,
  ]);

  const managedDeptIds = useMemo(() => {
    if (!isDeptHeadOnly) return undefined;
    const ids = new Set<string>();
    if (myDeptId) ids.add(myDeptId);
    return [...ids];
  }, [isDeptHeadOnly, myDeptId]);

  // Default view for approvers = pending approvals list across all departments they can see.
  const [view, setView] = useState<SchedulesView>(
    search.view ?? (search.dept || search.week ? "editor" : canApprove ? "pending" : canPublishDirect ? "approved" : "editor"),
  );


  // Department selection
  const deptsQ = useQuery({
    queryKey: ["departments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, is_active")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Departments that already have a SAVED schedule (schedule row + at least
  // one shift) for the selected week. Used to hide them from the department
  // dropdown so each department can only have one saved schedule per week.
  // The query key includes weekStart so it recomputes automatically when the
  // week changes, and it is invalidated after save/delete mutations.




  const [selectedDept, setSelectedDept] = useState<string | null>(search.dept ?? null);
  const [focusedScheduleId, setFocusedScheduleId] = useState<string | null>(null);

  function navigateWeek(next: string) {
    setFocusedScheduleId(null);
    setWeekStart(getPeriodStart(next, periodConfig));
  }

  function selectDepartment(deptId: string) {
    setFocusedScheduleId(null);
    setSelectedDept(deptId);
  }

  const [weekStart, setWeekStart] = useState(() =>
    search.week
      ? getPeriodStartFromDate(new Date(search.week + "T00:00:00Z"), DEFAULT_PERIOD_CONFIG)
      : getPeriodStartFromDate(new Date(), DEFAULT_PERIOD_CONFIG),
  );

  const initialWeekSetRef = useRef(!!search.week);

  // On page entry default to the current schedule period (unless URL specifies ?week=).
  // Re-normalizing a Sat-based placeholder with Sun–Fri config was jumping to an old week.
  useEffect(() => {
    if (meLoading || !periodConfigQ.isSuccess) return;

    if (search.week) {
      setWeekStart(getPeriodStart(search.week, periodConfig));
      return;
    }

    if (initialWeekSetRef.current) return;
    setWeekStart(getPeriodStartFromDate(new Date(), periodConfig));
    initialWeekSetRef.current = true;
  }, [
    meLoading,
    periodConfigQ.isSuccess,
    search.week,
    periodConfig.schedule_type,
    periodConfig.week_start_dow,
    periodConfig.week_end_dow,
  ]);

  /** Dept head may only browse/create for current week + next week. */
  const deptHeadWeekWindow = useMemo(() => {
    const current = getPeriodStartFromDate(new Date(), periodConfig);
    const next = shiftPeriodStart(current, periodConfig, 1);
    return { current, next };
  }, [weekStart, periodConfig]);

  useEffect(() => {
    if (!isDeptHeadOnly) return;
    const { current, next } = deptHeadWeekWindow;
    if (weekStart < current || weekStart > next) {
      setWeekStart(current);
    }
  }, [isDeptHeadOnly, weekStart, deptHeadWeekWindow]);

  const getSchedulesFn = useServerFn(getSchedulesForViewer);
  const deptWeekFlagsFn = useServerFn(getDepartmentWeekScheduleFlags);
  const weekSchedulesQ = useQuery({
    enabled: !!me?.id && view === "editor",
    queryKey: ["week-schedules", weekStart, me?.id],
    queryFn: async () => {
      const rows = await getSchedulesFn({ data: { week_start: weekStart } });
      return (rows ?? []).map((row: any) => ({
        id: row.id,
        department_id: row.department_id,
        status: row.status,
        published_at: row.published_at,
      }));
    },
  });

  const deptsWithSchedule = useMemo(
    () => new Set((weekSchedulesQ.data ?? []).map((s) => s.department_id)),
    [weekSchedulesQ.data],
  );

  const deptsWithoutSchedule = useMemo(
    () => (deptsQ.data ?? []).filter((d) => !deptsWithSchedule.has(d.id)),
    [deptsQ.data, deptsWithSchedule],
  );

  useEffect(() => {
    if (selectedDept) return;
    if (search.dept) setSelectedDept(search.dept);
    else if (isDeptHeadOnly && myDeptId) setSelectedDept(myDeptId);
    else if (isEmployee && myDeptId) setSelectedDept(myDeptId);
    else if (deptsWithoutSchedule.length) setSelectedDept(deptsWithoutSchedule[0].id);
    else if (deptsQ.data?.length) setSelectedDept(deptsQ.data[0].id);
  }, [deptsQ.data, deptsWithoutSchedule, myDeptId, selectedDept, isDeptHeadOnly, isEmployee, search.dept]);

  // All schedules + shifts for the selected week. Powers:
  //  - `savedDeptSet`: departments with at least one saved shift (hidden from
  //    the department dropdown so each dept has only one saved schedule/week).
  //  - `dailyShiftSummary`: cross-branch daily counters — saved shifts from
  //    OTHER departments + current unsaved edits from the selected dept.
  //  - The "סידורי עבודה שמורים" card listing saved departments.
  const weekSavedQ = useQuery({
    enabled: (view === "editor" || view === "saved") && !!scheduleViewerCaps,
    queryKey: ["schedules-week-saved", weekStart, me?.id],
    queryFn: async () => {
      const { data: scheds, error } = await supabase
        .from("schedules")
        .select("id, department_id, status, published_at, updated_at, submitted_at, created_by")
        .eq("week_start", weekStart);
      if (error) throw error;
      if (!scheds?.length)
        return {
          shifts: [] as { schedule_id: string; department_id: string; employee_id: string; day_date: string; shift: string }[],
          deptIdsWithSaved: [] as string[],
          savedList: [] as { schedule_id: string; department_id: string; status: string; published_at: string | null; updated_at: string | null }[],
        };
      const ids = scheds.map((s: any) => s.id);
      const { data: shiftRows, error: e2 } = await supabase
        .from("schedule_shifts")
        .select("schedule_id, employee_id, day_date, shift, leave_type_code")
        .in("schedule_id", ids);
      if (e2) throw e2;
      const schedById = new Map<string, any>((scheds as any[]).map((s) => [s.id, s]));
      const shifts = (shiftRows ?? []).map((r: any) => ({
        ...r,
        department_id: schedById.get(r.schedule_id)?.department_id as string,
      }));
      const withShiftsIds = new Set(shifts.map((r) => r.schedule_id));
      const savedScheds = (scheds as any[]).filter((s) => withShiftsIds.has(s.id));
      const visibleSavedScheds =
        scheduleViewerCaps == null
          ? savedScheds
          : savedScheds.filter((s) =>
              canViewScheduleContent(s, scheduleViewerCaps, managedDeptIds),
            );
      const awaitingPublishScheds = visibleSavedScheds.filter((s) =>
        isSavedScheduleAwaitingPublish(s),
      );
      const deptIdsWithSaved = Array.from(
        new Set(awaitingPublishScheds.map((s) => s.department_id)),
      );
      const savedList = awaitingPublishScheds.map((s) => ({
        schedule_id: s.id,
        department_id: s.department_id,
        status: s.status,
        published_at: s.published_at ?? null,
        updated_at: s.updated_at ?? null,
      }));
      return { shifts, deptIdsWithSaved, savedList };
    },
  });

  const branchSavedSchedulesQ = useQuery({
    enabled:
      !!scheduleViewerCaps &&
      !isEmployee &&
      (canSeeScheduleQueues || canCreate),
    queryKey: ["schedules-branch-saved", me?.id],
    queryFn: async () => {
      try {
        const { data: scheds, error } = await supabase
          .from("schedules")
          .select(
            "id, department_id, week_start, week_end, status, published_at, updated_at, created_by",
          )
          .order("week_start", { ascending: false });
        if (error) throw error;
        if (!scheds?.length) return { savedList: [] as SavedScheduleListItem[] };
        const ids = scheds.map((s: { id: string }) => s.id);
        const { data: shiftRows, error: e2 } = await supabase
          .from("schedule_shifts")
          .select("schedule_id")
          .in("schedule_id", ids);
        if (e2) throw e2;
        const withShiftsIds = new Set((shiftRows ?? []).map((r: { schedule_id: string }) => r.schedule_id));
        const savedScheds = (scheds as any[]).filter((s) => withShiftsIds.has(s.id));
        const visibleSavedScheds =
          scheduleViewerCaps == null
            ? savedScheds
            : savedScheds.filter((s) =>
                canViewScheduleContent(s, scheduleViewerCaps, managedDeptIds),
              );
        const savedList: SavedScheduleListItem[] = visibleSavedScheds
          .map((s) => ({
            schedule_id: s.id,
            department_id: s.department_id,
            week_start: s.week_start,
            week_end: s.week_end,
            status: s.status,
            published_at: s.published_at ?? null,
            updated_at: s.updated_at ?? null,
          }))
          .filter((s) => isSavedScheduleAwaitingPublish(s));
        return { savedList };
      } catch (err) {
        console.error("[schedules-branch-saved]", err);
        return { savedList: [] as SavedScheduleListItem[] };
      }
    },
  });

  const branchSavedList = branchSavedSchedulesQ.data?.savedList ?? [];
  const branchSavedPeriodGroups = useMemo(
    () => groupSchedulesByPeriod(branchSavedList),
    [branchSavedList],
  );

  const savedDeptSet = useMemo(
    () => new Set(weekSavedQ.data?.deptIdsWithSaved ?? []),
    [weekSavedQ.data],
  );

  /** Departments with no saved schedule shifts yet for this week (includes none created). */
  const deptsPendingSchedule = useMemo(
    () => (deptsQ.data ?? []).filter((d) => !savedDeptSet.has(d.id)),
    [deptsQ.data, savedDeptSet],
  );

  const switchableDepts = useMemo(
    () => deptsPendingSchedule.filter((d) => d.id !== selectedDept),
    [deptsPendingSchedule, selectedDept],
  );

  const canSwitchDepartments = !isEmployee && canViewBranchSchedules;



  useEffect(() => {
    if (canSeeScheduleQueues && view === "editor" && !selectedDept) setView(canApprove ? "pending" : "approved");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSeeScheduleQueues, canApprove]);

  const pendingQ = useQuery({
    enabled: canSeeScheduleQueues,
    queryKey: ["schedules-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select(
          "id, department_id, week_start, week_end, status, created_by, submitted_at, submitted_by",
        )
        .eq("status", "pending_approval")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const approvedQ = useQuery({
    enabled: canSeeScheduleQueues,
    queryKey: ["schedules-approved"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select(
          "id, department_id, week_start, week_end, status, created_by, approved_at, approved_by, published_at",
        )
        .eq("status", "approved")
        .not("published_at", "is", null)
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const publishedPeriodGroups = useMemo(
    () =>
      groupSchedulesByPeriodLimitedPerDept(
        approvedQ.data ?? [],
        2,
        (r) => r.published_at ?? r.approved_at,
      ),
    [approvedQ.data],
  );

  const publishedDisplayCount = useMemo(
    () => publishedPeriodGroups.reduce((n, g) => n + g.items.length, 0),
    [publishedPeriodGroups],
  );

  const latestPublishedByDept = useMemo(
    () => latestPublishedIdByDepartment(approvedQ.data ?? []),
    [approvedQ.data],
  );

  const pendingCreatorIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pendingQ.data ?? []) {
      if (p.created_by) s.add(p.created_by);
      if (p.submitted_by) s.add(p.submitted_by);
    }
    for (const a of approvedQ.data ?? []) {
      if (a.created_by) s.add(a.created_by);
      if (a.approved_by) s.add(a.approved_by);
    }
    return Array.from(s);
  }, [pendingQ.data, approvedQ.data]);

  const pendingPeopleQ = useQuery({
    enabled: pendingCreatorIds.length > 0,
    queryKey: ["pending-people", pendingCreatorIds.join(",")],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_profiles_basic_info", {
        user_ids: pendingCreatorIds,
      });
      const m: Record<string, string> = {};
      for (const r of data ?? []) m[r.id] = r.full_name;
      return m;
    },
  });


  // Schedule for selected dept+week
  const schedQ = useQuery({
    enabled: !!selectedDept && !!me?.id && view === "editor",
    queryKey: ["schedule", selectedDept, weekStart, focusedScheduleId, me?.id],
    queryFn: async () => {
      if (focusedScheduleId) {
        const { data, error } = await supabase
          .from("schedules")
          .select("*")
          .eq("id", focusedScheduleId)
          .maybeSingle();
        if (error) throw error;
        if (
          data &&
          scheduleViewerCaps &&
          canViewScheduleContent(data, scheduleViewerCaps, managedDeptIds)
        ) {
          return data;
        }
        return null;
      }

      const rows = await getSchedulesFn({
        data: { week_start: weekStart, department_id: selectedDept! },
      });
      const exact = (rows ?? [])[0] ?? null;
      if (exact) return exact;

      // Some legacy/edge schedules can overlap the week without matching the
      // exact week_start key. Keep employee read view from appearing empty when
      // dashboard already shows a valid published schedule.
      if (isEmployee) {
        const { data: overlapRows, error } = await supabase
          .from("schedules")
          .select("*")
          .eq("department_id", selectedDept!)
          .eq("status", "approved")
          .not("published_at", "is", null)
          .lte("week_start", weekEnd)
          .gte("week_end", weekStart)
          .order("published_at", { ascending: false })
          .limit(1);
        if (error) throw error;
        return (overlapRows ?? [])[0] ?? null;
      }

      return null;
    },
  });

  const weekEnd = useMemo(() => {
    const periodStart = getPeriodStart(weekStart, periodConfig);
    if (
      schedQ.data?.week_end &&
      schedQ.data?.week_start === periodStart
    ) {
      return schedQ.data.week_end as string;
    }
    return getPeriodEnd(periodStart, periodConfig);
  }, [schedQ.data?.week_end, schedQ.data?.week_start, weekStart, periodConfig]);

  const days = useMemo(() => {
    if (schedQ.data?.week_start && schedQ.data?.week_end) {
      return filterDaysByPeriodConfig(
        buildDaysBetween(schedQ.data.week_start as string, schedQ.data.week_end as string),
        periodConfig,
      );
    }
    return buildPeriodDays(getPeriodStart(weekStart, periodConfig), periodConfig);
  }, [schedQ.data?.week_start, schedQ.data?.week_end, weekStart, periodConfig]);

  const deptWeekFlagsQ = useQuery({
    enabled: !!selectedDept && !!me?.id && (view === "editor" || isDeptHeadOnly),
    queryKey: ["dept-schedule-flags", selectedDept, weekStart, me?.id],
    queryFn: () =>
      deptWeekFlagsFn({
        data: { department_id: selectedDept!, week_start: weekStart },
      }),
  });

  const blockedCreatorId = deptWeekFlagsQ.data?.awaitingPublish?.created_by ?? null;
  const blockedCreatorQ = useQuery({
    enabled: !!blockedCreatorId,
    queryKey: ["schedule-blocked-creator", blockedCreatorId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_profiles_basic_info", {
        user_ids: [blockedCreatorId],
      });
      return (data?.[0]?.full_name as string | undefined) ?? "לא ידוע";
    },
  });

  useEffect(() => {
    if (!selectedDept || view !== "editor") return;
    const ch = supabase
      .channel(`schedules-dept-flags-${selectedDept}-${weekStart}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        qc.invalidateQueries({ queryKey: ["dept-schedule-flags", selectedDept, weekStart] });
        qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [selectedDept, weekStart, view, qc]);

  useEffect(() => {
    if (!me?.id || isEmployee) return;
    const ch = supabase
      .channel(`schedules-branch-${me.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
        qc.invalidateQueries({ queryKey: ["schedules-week-saved"] });
        qc.invalidateQueries({ queryKey: ["schedules-pending"] });
        qc.invalidateQueries({ queryKey: ["schedules-approved"] });
        qc.invalidateQueries({ queryKey: ["week-schedules"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "schedule_shifts" }, () => {
        qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
        qc.invalidateQueries({ queryKey: ["schedules-week-saved"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me?.id, isEmployee, qc]);

  // Creator / Editor / Approver details for the visible schedule.
  const decisionPersonQ = useQuery({
    enabled: !!schedQ.data,
    queryKey: [
      "schedule-decision",
      schedQ.data?.id,
      schedQ.data?.status,
      schedQ.data?.approved_by,
      schedQ.data?.rejected_by,
      schedQ.data?.created_by,
      (schedQ.data as any)?.updated_by,
      (schedQ.data as any)?.updated_at,
    ],
    queryFn: async () => {
      const s: any = schedQ.data!;
      const auditRes = await supabase
        .from("schedule_audit_log")
        .select("actor_id, action, created_at")
        .eq("schedule_id", s.id)
        .order("created_at", { ascending: true });
      const auditList = ((auditRes.data ?? []) as any[]).filter(Boolean);
      const auditActorIds = auditList.map((r) => r.actor_id).filter(Boolean);
      const ids = Array.from(
        new Set(
          [
            s.created_by,
            s.approved_by,
            s.rejected_by,
            s.submitted_by,
            s.updated_by,
            ...auditActorIds,
          ].filter((v): v is string => !!v),
        ),
      );
      const profRes = ids.length
        ? await (supabase as any).rpc("get_profiles_basic_info", { user_ids: ids })
        : { data: [] as any[] };
      const profMap = new Map<string, any>(((profRes as any).data ?? []).map((p: any) => [p.id, p]));
      const buildPerson = (uid: string | null, at: string | null) => {
        if (!uid) return null;
        const p = profMap.get(uid);
        return {
          id: uid,
          full_name: p?.full_name ?? "לא ידוע",
          job_title: p?.job_title ?? null,
          role_label: p?.role_label ?? "לא ידוע",
          at,
        };
      };

      // Find the latest explicit edit/copy event for the schedule. If an old row
      // does not have such an audit row, fall back to schedules.updated_by and
      // ultimately to the creator so the editor metadata is never blank.
      let editor: SchedulePersonMeta = null;
      const createdRow = auditList.find((r) => r.action === "created");
      const approvedRow = [...auditList].reverse().find((r) => r.action === "approved" || r.action === "published");
      const rejectedRow = [...auditList].reverse().find((r) => r.action === "rejected");
      const creatorId = s.created_by ?? createdRow?.actor_id ?? null;
      const approvedT = s.approved_at ? new Date(s.approved_at).getTime() : Infinity;
      const submittedT = s.submitted_at ? new Date(s.submitted_at).getTime() : 0;
      const updatesBeforeApproval = auditList.filter(
        (r) =>
          (r.action === "updated" || r.action === "copied") &&
          r.actor_id &&
          r.actor_id !== creatorId &&
          new Date(r.created_at).getTime() <= approvedT &&
          new Date(r.created_at).getTime() >= submittedT,
      );
      const editRows = auditList.filter(
        (r) => (r.action === "updated" || r.action === "copied") && r.actor_id,
      );

      let lastEditorId = s.updated_by;
      let lastUpdateAt = s.updated_at;

      if (editRows.length) {
        const last = editRows[editRows.length - 1];
        lastEditorId = last.actor_id;
        lastUpdateAt = last.created_at;
      }

      if (lastEditorId) {
        editor = buildPerson(lastEditorId, lastUpdateAt);
      }

      // creation timestamp from audit (first "created"), fallback to schedule.created_at
      const createdAt = createdRow?.created_at ?? s.created_at ?? null;

      const creator = buildPerson(creatorId, createdAt);
      if (!editor && creatorId) {
        editor = buildPerson(creatorId, s.updated_at ?? createdAt);
      }
      const approver = s.status === "approved"
        ? buildPerson(s.approved_by ?? approvedRow?.actor_id ?? null, s.approved_at ?? approvedRow?.created_at ?? null)
        : null;
      const rejecter = s.status === "rejected"
        ? buildPerson(s.rejected_by ?? rejectedRow?.actor_id ?? null, s.rejected_at ?? rejectedRow?.created_at ?? null)
        : null;

      // legacy fields used elsewhere in the file
      const decision = approver ?? rejecter;
      return {
        creator,
        editor,
        approver,
        rejecter,
        editedBeforeApproval: updatesBeforeApproval.length > 0 && s.status === "approved",
        full_name: decision?.full_name ?? "—",
        job_title: decision?.job_title ?? null,
        role_label: decision?.role_label ?? null,
        at: decision?.at ?? null,
      };
    },
  });


  const visible = useMemo(() => {
    const s = schedQ.data as any;
    if (!s || !scheduleViewerCaps) return null;
    if (!canViewScheduleContent(s, scheduleViewerCaps, managedDeptIds)) return null;
    return s;
  }, [schedQ.data, scheduleViewerCaps, managedDeptIds]);

  const latestPublishedScheduleIdQ = useQuery({
    enabled:
      !!visible?.department_id &&
      visible.status === "approved" &&
      !!(visible as { published_at?: string | null }).published_at,
    queryKey: ["schedule-latest-published-dept", visible?.department_id],
    queryFn: () =>
      getLatestPublishedScheduleIdForDepartment(supabase, visible!.department_id),
  });

  const isSupersededPublished = useMemo(
    () =>
      !!visible &&
      isSupersededPublishedSchedule(
        {
          id: visible.id,
          status: visible.status,
          published_at: (visible as { published_at?: string | null }).published_at ?? null,
        },
        latestPublishedScheduleIdQ.data ?? null,
      ),
    [visible, latestPublishedScheduleIdQ.data],
  );

  /**
   * Dept head: hide "סידורי עבודה שמורים" / "עריכת סידור שבועי" for the week
   * being viewed when a published schedule exists OR a manager-saved schedule
   * is awaiting publish (draft / pending / approved-unpublished).
   */
  const deptHeadScheduleNavBlocked = useMemo(() => {
    if (!isDeptHeadOnly) return false;
    if (deptWeekFlagsQ.data?.hasPublished) return true;
    if (deptWeekFlagsQ.data?.hasSavedAwaitingPublish) return true;
    if (visible?.status === "approved" && !!(visible as any).published_at) return true;
    if (visible && isSavedScheduleAwaitingPublish(visible as any)) return true;
    const deptId = selectedDept ?? myDeptId;
    if (!deptId) return false;
    return (weekSavedQ.data?.savedList ?? []).some((s) => {
      if (s.department_id !== deptId) return false;
      if (s.status === "approved" && s.published_at) return true;
      return isSavedScheduleAwaitingPublish(s);
    });
  }, [
    isDeptHeadOnly,
    deptWeekFlagsQ.data?.hasPublished,
    deptWeekFlagsQ.data?.hasSavedAwaitingPublish,
    visible,
    selectedDept,
    myDeptId,
    weekSavedQ.data?.savedList,
  ]);

  useEffect(() => {
    if (deptHeadScheduleNavBlocked && view === "saved") {
      setView("editor");
    }
  }, [deptHeadScheduleNavBlocked, view]);

  const changeBaselineKind = useMemo(
    () =>
      visible
        ? resolveScheduleChangeBaselineKind({
            status: visible.status,
            published_at: (visible as any).published_at ?? null,
            submitted_at: (visible as any).submitted_at ?? null,
          })
        : null,
    [visible],
  );

  // Employees in this department.
  // Plain employees query a safe view that exposes only non-sensitive fields
  // of coworkers in their own department; managers/admins read from profiles
  // directly under their existing RLS policies.
  const empsQ = useQuery({
    enabled: !!selectedDept && view === "editor",
    queryKey: ["dept-employees", selectedDept, isEmployee],
    queryFn: async () => {
      if (isEmployee) {
        const { data, error } = await (supabase as any)
          .from("department_coworkers")
          .select("id, full_name, is_active, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code")
          .eq("department_id", selectedDept!)
          .eq("is_active", true)
          .order("full_name");
        if (error) throw error;
        return (data ?? []) as {
          id: string;
          full_name: string;
          is_active: boolean;
          excluded_from_schedule: boolean;
          excluded_from_headcount?: boolean;
          on_leave: boolean;
          leave_start_date: string | null;
          leave_end_date: string | null;
        }[];
      }
      const [{ data, error }, { data: dept }] = await Promise.all([
        supabase
        .from("profiles")
        .select("id, full_name, is_active, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code")
        .eq("department_id", selectedDept!)
        .eq("is_active", true)
          .order("full_name"),
        supabase.from("departments").select("manager_id").eq("id", selectedDept!).maybeSingle(),
      ]);
      if (error) throw error;
      const rows = [...(data ?? [])];
      const managerId = (dept as any)?.manager_id as string | null | undefined;
      if (managerId && !rows.some((e: any) => e.id === managerId)) {
        const { data: mgr } = await supabase
          .from("profiles")
          .select("id, full_name, department_id, is_active, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code")
          .eq("id", managerId)
          .eq("department_id", selectedDept!)
          .eq("is_active", true)
          .maybeSingle();
        if (mgr) rows.push(mgr as any);
      }
      rows.sort((a: any, b: any) => String(a.full_name ?? "").localeCompare(String(b.full_name ?? ""), "he"));
      return rows;
    },
  });

  const weekShiftEmployeeIds = useMemo(
    () =>
      Array.from(
        new Set((weekSavedQ.data?.shifts ?? []).map((r) => r.employee_id).filter(Boolean)),
      ),
    [weekSavedQ.data],
  );

  const savedShiftHeadcountExcludedQ = useQuery({
    enabled: weekShiftEmployeeIds.length > 0,
    queryKey: ["schedule-saved-headcount-excluded", weekShiftEmployeeIds.slice().sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id")
        .in("id", weekShiftEmployeeIds)
        .eq("excluded_from_headcount", true);
      if (error) throw error;
      return (data ?? []).map((p) => p.id as string);
    },
  });

  const headcountExcludedSet = useMemo(() => {
    const set = new Set(savedShiftHeadcountExcludedQ.data ?? []);
    for (const e of empsQ.data ?? []) {
      if (e.excluded_from_headcount) set.add(e.id);
    }
    return set;
  }, [savedShiftHeadcountExcludedQ.data, empsQ.data]);

  // Shifts (only if a schedule exists and is visible)
  const shiftsQ = useQuery({
    enabled: !!visible?.id && view === "editor",
    queryKey: ["schedule-shifts", visible?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_shifts")
        .select(
          "employee_id, day_date, shift, leave_type_code, published_shift, published_note, published_start_time, published_end_time, submitted_shift, submitted_note, submitted_start_time, submitted_end_time, start_time, end_time, note",
        )
        .eq("schedule_id", visible!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Local edits map: emp -> day -> shift
  const [edits, setEdits] = useState<Record<string, Record<string, Shift>>>({});
  // Per-cell time overrides. `null` = use shift definition default.
  const [timeEdits, setTimeEdits] = useState<
    Record<string, Record<string, CellTimeOverride>>
  >({});
  const [noteEdits, setNoteEdits] = useState<Record<string, Record<string, string | null>>>({});
  /** leave_type_code per emp|day from DB / profile — drives חופש רגיל / חופש מחלה labels */
  const [leaveTypeByCell, setLeaveTypeByCell] = useState<Record<string, string | null>>({});
  const editsDirtyRef = useRef(false);
  const editsScheduleIdRef = useRef<string | null>(null);
  const submittedBaselineRef = useRef<{
    key: string;
    map: Record<
      string,
      { shift: string | null; start: string | null; end: string | null; note: string | null }
    >;
  }>({ key: "", map: {} });

  const reseedEditsFromShifts = (
    rows: NonNullable<typeof shiftsQ.data>,
    emps: NonNullable<typeof empsQ.data>,
  ) => {
    const next: Record<string, Record<string, Shift>> = {};
    const t: Record<string, Record<string, CellTimeOverride>> = {};
    const n: Record<string, Record<string, string | null>> = {};
    const leaveMap: Record<string, string | null> = {};
    for (const s of rows) {
      next[s.employee_id] ??= {};
      next[s.employee_id][s.day_date] = s.shift as Shift;
      t[s.employee_id] ??= {};
      const st = (s as any).start_time ? String((s as any).start_time).slice(0, 5) : null;
      const en = (s as any).end_time ? String((s as any).end_time).slice(0, 5) : null;
      const shiftCode = s.shift as string;
      if (shiftCode && shiftCode !== "off") {
        const defTimes = shiftDefsQ.getTimesForDay(shiftCode, s.day_date);
        const defStart = hmFromValue(defTimes.start_time);
        const defEnd = hmFromValue(defTimes.end_time);
        const override: CellTimeOverride = {};
        if (st !== null && st !== defStart) override.start = st;
        if (en !== null && en !== defEnd) override.end = en;
        if (Object.keys(override).length > 0) {
          t[s.employee_id][s.day_date] = override;
        }
      } else if (st || en) {
        t[s.employee_id][s.day_date] = {
          ...(st ? { start: st } : {}),
          ...(en ? { end: en } : {}),
        };
      }
      n[s.employee_id] ??= {};
      const rawNote = (s as any).note ? trimScheduleNote(String((s as any).note)) : "";
      n[s.employee_id][s.day_date] = rawNote || null;
      const ltc = (s as any).leave_type_code ? String((s as any).leave_type_code) : null;
      if (ltc) leaveMap[`${s.employee_id}|${s.day_date}`] = ltc;
    }
    for (const emp of emps) {
      for (const day of days) {
        if (isEmployeeOnLeaveOnDate(emp, day)) {
          next[emp.id] ??= {};
          next[emp.id][day] = "off";
          const key = `${emp.id}|${day}`;
          if (!leaveMap[key] && (emp as any).leave_type_code) {
            leaveMap[key] = String((emp as any).leave_type_code);
          }
        }
      }
    }
    setEdits(next);
    setTimeEdits(t);
    setNoteEdits(n);
    setLeaveTypeByCell(leaveMap);
    editsDirtyRef.current = false;
  };

  useEffect(() => {
    if (!visible?.id || !shiftsQ.data || !empsQ.data || !shiftDefsQ.isSuccess) return;
    if (editsScheduleIdRef.current !== visible.id) {
      editsScheduleIdRef.current = visible.id;
      editsDirtyRef.current = false;
      submittedBaselineRef.current = { key: "", map: {} };
      reseedEditsFromShifts(shiftsQ.data, empsQ.data);
      return;
    }
    if (!editsDirtyRef.current) {
      reseedEditsFromShifts(shiftsQ.data, empsQ.data);
    }
  }, [visible?.id, shiftsQ.data, empsQ.data, days, shiftDefsQ.isSuccess]);

  const changeBaselineSubmitted = useMemo(() => {
    if (!visible?.submitted_at || !shiftsQ.data?.length || !shiftDefsQ.isSuccess) return {};
    const key = `${visible.id}|${visible.submitted_at}`;
    const fresh = buildChangeBaselineMap(shiftsQ.data, "submitted", shiftDefsQ.map);
    const freshHasEntries = Object.keys(fresh).length > 0;
    const frozenHasEntries = Object.keys(submittedBaselineRef.current.map).length > 0;
    if (
      submittedBaselineRef.current.key !== key ||
      (!frozenHasEntries && freshHasEntries)
    ) {
      submittedBaselineRef.current = { key, map: fresh };
    }
    return submittedBaselineRef.current.map;
  }, [
    visible?.id,
    visible?.submitted_at,
    shiftsQ.data,
    shiftDefsQ.isSuccess,
    shiftDefsQ.map,
  ]);

  const changeBaselinePublished = useMemo(() => {
    if (!shiftsQ.data?.length || !shiftDefsQ.isSuccess) return {};
    return buildChangeBaselineMap(shiftsQ.data, "published", shiftDefsQ.map);
  }, [shiftsQ.data, shiftDefsQ.isSuccess, shiftDefsQ.map]);

  const includeSubmittedDiffWhenPublished =
    isMainAdmin || isBranchMgr || isDeptMgr || canApprove || canPublishDirect;

  // Realtime: global RealtimeBridge in app-shell keeps schedule queries fresh.

  // ---- Server fns ----
  const createFn = useServerFn(createOrGetSchedule);
  const saveFn = useServerFn(saveScheduleShifts);
  const submitFn = useServerFn(submitSchedule);
  const approveFn = useServerFn(approveSchedule);
  const publishFn = useServerFn(publishSchedule);
  const publishAllFn = useServerFn(publishAllWeekSchedules);
  
  const copyFn = useServerFn(copyPreviousWeek);
  const setExclusionFn = useServerFn(setEmployeeScheduleExclusion);

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { department_id: selectedDept!, week_start: weekStart } }),
    onSuccess: () => {
      toast.success(i18n.t("schedules.savedDraft"));
      qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
      qc.invalidateQueries({ queryKey: ["week-schedules", weekStart] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      return saveFn({ data: { schedule_id: visible!.id, shifts: prepareShiftPayloadForPersist() } });
    },
    onSuccess: () => {
      toast.success(i18n.t("schedules.saved"));
      editsDirtyRef.current = false;
      qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedule-decision"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
    },

    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      // Persist any unsaved local edits before validating on the server,
      // so the validator sees the actual on-screen schedule.
      await saveFn({ data: { schedule_id: visible!.id, shifts: prepareShiftPayloadForPersist() } });
      return submitFn({ data: { schedule_id: visible!.id } });
    },
    onSuccess: (r: any) => {
      toast.success(r?.published ? i18n.t("schedules.published") : r?.approved ? i18n.t("schedules.approvedPending") : i18n.t("schedules.sentForApproval"));
      editsDirtyRef.current = false;
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
      qc.invalidateQueries({ queryKey: ["schedules-approved"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
      qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });


  const approveMut = useMutation({
    mutationFn: async () => {
      // Persist any current edits made by the approver before publishing,
      // so the published version reflects exactly what's on screen.
      await saveFn({ data: { schedule_id: visible!.id, shifts: prepareShiftPayloadForPersist() } });
      return approveFn({ data: { schedule_id: visible!.id } });
    },
    onSuccess: (r: any) => {
      toast.success(r?.published ? i18n.t("schedules.published") : i18n.t("schedules.approvedPending"));
      editsDirtyRef.current = false;
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
      qc.invalidateQueries({ queryKey: ["schedules-approved"] });
      qc.invalidateQueries({ queryKey: ["schedule-decision"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
      qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
      qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const publishMut = useMutation({
    mutationFn: async () => {
      await saveFn({ data: { schedule_id: visible!.id, shifts: prepareShiftPayloadForPersist() } });
      return publishFn({ data: { schedule_id: visible!.id } });
    },
    onSuccess: () => {
      toast.success(i18n.t("schedules.published"));
      editsDirtyRef.current = false;
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedules-approved"] });
      qc.invalidateQueries({ queryKey: ["schedule-decision"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
      qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
      qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [publishPeriodWeekStart, setPublishPeriodWeekStart] = useState(weekStart);
  const publishPeriodUnpublishedCount = useMemo(
    () =>
      branchSavedList.filter(
        (s) => s.week_start === publishPeriodWeekStart && isSavedScheduleAwaitingPublish(s),
      ).length,
    [branchSavedList, publishPeriodWeekStart],
  );
  const openPublishAllForPeriod = (periodWeekStart: string) => {
    setPublishPeriodWeekStart(periodWeekStart);
    setPublishAllOpen(true);
  };
  const publishAllMut = useMutation({
    mutationFn: () => publishAllFn({ data: { week_start: publishPeriodWeekStart } }),
    onSuccess: (res: any) => {
      setPublishAllOpen(false);
      if (res?.published > 0) {
        toast.success(`פורסמו ${res.published} סידורי עבודה`);
      } else {
        toast.info("אין סידורים לפרסום");
      }
      if (res?.errors?.length) {
        toast.warning(`לא פורסמו ${res.errors.length} סידורים`);
      }
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
      qc.invalidateQueries({ queryKey: ["schedules-approved"] });
      qc.invalidateQueries({ queryKey: ["schedule-decision"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
      qc.invalidateQueries({ queryKey: ["dashboard-approved-list"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["schedules-branch-saved"] });
      qc.invalidateQueries({ queryKey: ["emp-dash-schedule"] });
      qc.invalidateQueries({ queryKey: ["daily-schedule-overview"] });
      qc.invalidateQueries({ queryKey: ["dept-schedule-flags"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בפרסום"),
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const copyMut = useMutation({
    mutationFn: () => copyFn({ data: { schedule_id: visible!.id } }),
    onSuccess: (r) => {
      toast.success(`הועתקו ${r.count} שיבוצים מהשבוע הקודם`);
      setCopyOpen(false);
      qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedule-decision"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
    },

    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה");
      setCopyOpen(false);
    },
  });

  const exclusionMut = useMutation({
    mutationFn: (args: { user_id: string; excluded: boolean }) =>
      setExclusionFn({
        data: {
          user_id: args.user_id,
          excluded: args.excluded,
          schedule_id: visible?.id,
        },
      }),
    onSuccess: (_data, vars) => {
      toast.success(
        vars.excluded ? "העובד הוגדר כלא נכלל בסידור" : "העובד נכלל שוב בסידור",
      );
      qc.invalidateQueries({ queryKey: ["dept-employees", selectedDept] });
      if (visible?.id) {
        qc.invalidateQueries({ queryKey: ["schedule-shifts", visible.id] });
      }
      if (vars.excluded) {
        setEdits((prev) => {
          const next = { ...prev };
          delete next[vars.user_id];
          return next;
        });
        setTimeEdits((prev) => {
          const next = { ...prev };
          delete next[vars.user_id];
          return next;
        });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });

  const deleteFn = useServerFn(deleteSchedule);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { schedule_id: visible!.id } }),
    onSuccess: () => {
      toast.success(i18n.t("schedules.deleted"));
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      qc.invalidateQueries({ queryKey: ["schedules-week-saved", weekStart] });
      qc.invalidateQueries({ queryKey: ["week-schedules"] });
    },

    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה");
      setDeleteOpen(false);
    },
  });

  // Management: delete anytime.
  // Dept head: only own-dept draft/rejected (before send for approval) — never after.
  const canDeleteAsManagement =
    !isDeptHeadOnly &&
    !isEmployee &&
    (isMainAdmin ||
      isBranchManager ||
      canCreate ||
      canEdit ||
      canApprove ||
      canPublishDirect);
  const canDeleteAsDeptHeadDraft =
    isDeptHeadOnly &&
    (visible?.status === "draft" || visible?.status === "rejected");
  const canDelete =
    !!visible &&
    (isSupersededPublished
      ? isMainAdmin
      : canDeleteAsManagement || canDeleteAsDeptHeadDraft);

  function setShift(empId: string, day: string, value: string) {
    editsDirtyRef.current = true;
    let shift: Shift;
    let leaveType: string | null = null;
    // Schedule editor only offers regular leave; sick comes from employee leave / requests.
    if (value === "off" || value === "off:regular" || value === "off:sick") {
      shift = "off";
      leaveType = "regular";
    } else {
      shift = value as Shift;
    }
    setEdits((prev) => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), [day]: shift } }));
    setLeaveTypeByCell((prev) => ({
      ...prev,
      [`${empId}|${day}`]: leaveType,
    }));
    // Always reset custom times when shift type changes so the new shift's
    // default hours take effect instead of carrying over old manual values.
    setTimeEdits((prev) => {
      const nextEmp = { ...(prev[empId] ?? {}) };
      delete nextEmp[day];
      return { ...prev, [empId]: nextEmp };
    });
  }

  function setCellTime(empId: string, day: string, which: "start" | "end", value: string) {
    if (!canEditScheduleTimes) return;
    editsDirtyRef.current = true;
    setTimeEdits((prev) => {
      const cur = prev[empId]?.[day] ?? {};
      const next = { ...cur, [which]: value ? value.slice(0, 5) : null };
      return { ...prev, [empId]: { ...(prev[empId] ?? {}), [day]: next } };
    });
  }

  function setCellNote(empId: string, day: string, value: string) {
    if (!canEditScheduleTimes) return;
    editsDirtyRef.current = true;
    const trimmed = value.trim().slice(0, SCHEDULE_NOTE_MAX);
    setNoteEdits((prev) => ({
      ...prev,
      [empId]: { ...(prev[empId] ?? {}), [day]: trimmed || null },
    }));
  }

  /** Empty cells (—) → חופש on save/publish; chosen morning/evening/off stay as-is. */
  function editsWithEmptyAsOff(
    base: Record<string, Record<string, Shift>>,
  ): Record<string, Record<string, Shift>> {
    const next: Record<string, Record<string, Shift>> = {};
    for (const emp of empsQ.data ?? []) {
      if (emp.excluded_from_schedule) continue;
      next[emp.id] = { ...(base[emp.id] ?? {}) };
      for (const day of days) {
        if (!next[emp.id][day] || isEmployeeOnLeaveOnDate(emp, day)) {
          next[emp.id][day] = "off";
        }
      }
    }
    return next;
  }

  function buildShiftPayload(
    sourceEdits: Record<string, Record<string, Shift>> = edits,
  ): {
    employee_id: string;
    day_date: string;
    shift: Shift;
    start_time: string | null;
    end_time: string | null;
    note: string | null;
    leave_type_code: string | null;
  }[] {
    const filled = editsWithEmptyAsOff(sourceEdits);
    const list: {
      employee_id: string;
      day_date: string;
      shift: Shift;
      start_time: string | null;
      end_time: string | null;
      note: string | null;
      leave_type_code: string | null;
    }[] = [];
    for (const [emp, m] of Object.entries(filled)) {
      const empRow = empsQ.data?.find((e) => e.id === emp);
      if (empRow?.excluded_from_schedule) continue;
      for (const [day, shift] of Object.entries(m)) {
        const resolved = empRow
          ? (effectiveScheduleShift(empRow, day, shift) as Shift)
          : shift;
        const t = timeEdits[emp]?.[day];
        const defTimes =
          resolved !== "off" ? shiftDefsQ.getTimesForDay(resolved, day) : { start_time: null, end_time: null };
        const defStart = hmFromValue(defTimes.start_time);
        const defEnd = hmFromValue(defTimes.end_time);
        const { start: effStart, end: effEnd } = resolveEffectiveCellTimes(t, defStart, defEnd);
        const norm = (v: string | null | undefined) =>
          v && /^\d{2}:\d{2}$/.test(v) ? `${v}:00` : v && /^\d{2}:\d{2}:\d{2}$/.test(v) ? v : null;
        const persistTime = (
          field: "start" | "end",
          effective: string | null,
          def: string | null,
        ): string | null => {
          const touched = !!(t && field in t);
          if (!touched && effective === def) return null;
          if (effective == null || effective === "") return null;
          return norm(effective);
        };
        const onLeave = empRow ? isEmployeeOnLeaveOnDate(empRow, day) : false;
        const leaveCode =
          resolved === "off"
            ? onLeave
              ? (((empRow as any)?.leave_type_code as string | null) ?? "regular")
              : "regular"
            : null;
        list.push({
          employee_id: emp,
          day_date: day,
          shift: resolved,
          start_time:
            resolved === "off" || !canEditScheduleTimes
              ? null
              : persistTime("start", effStart, defStart),
          end_time:
            resolved === "off" || !canEditScheduleTimes
              ? null
              : persistTime("end", effEnd, defEnd),
          note:
            resolved === "off" || !canEditScheduleTimes
              ? null
              : noteEdits[emp]?.[day]?.trim().slice(0, SCHEDULE_NOTE_MAX) || null,
          leave_type_code: leaveCode,
        });
      }
    }
    return list;
  }

  /** Fill empty cells as off in UI + return payload for save/publish. */
  function prepareShiftPayloadForPersist() {
    const filled = editsWithEmptyAsOff(edits);
    setEdits(filled);
    editsDirtyRef.current = true;
    return buildShiftPayload(filled);
  }

  // Draft ownership lock: a Department Manager who did NOT create the draft
  // cannot edit / delete / republish it. Only System Admin, Branch Manager,
  // or the original creator retain control. Applies to both draft and rejected.
  const isDraftLockedForMe =
    !!visible &&
    (visible.status === "draft" || visible.status === "rejected") &&
    !isMainAdmin &&
    !isBranchManager &&
    !canEdit &&
    visible.created_by !== me?.id;

  const managerSavedDraftBlocksMe =
    !visible &&
    !!deptWeekFlagsQ.data?.hasSavedAwaitingPublish &&
    isDeptHeadOnly;
  const blockedAwaitingStatus =
    deptWeekFlagsQ.data?.awaitingPublish?.status ??
    (visible?.status as string | undefined);
  const blockedSavedAt =
    deptWeekFlagsQ.data?.awaitingPublish?.saved_at ??
    (visible as { updated_at?: string | null } | null)?.updated_at ??
    (visible as { created_at?: string | null } | null)?.created_at ??
    null;

  const editable =
    !!visible &&
    !isSupersededPublished &&
    !isEmployee &&
    !isDraftLockedForMe &&
    (((visible.status === "draft" || visible.status === "rejected") &&
      (isMainAdmin || isBranchManager || canEdit || visible.created_by === me?.id))
      || (visible.status === "approved" && (isMainAdmin || canPublishDirect))
      || (visible.status === "pending_approval" && (isMainAdmin || canApprove || canPublishDirect)));

  const canToggleScheduleExclusion =
    canManageScheduleExclusion && !isEmployee && !!visible && editable;

  const canShowApprove =
    !!visible &&
    !isSupersededPublished &&
    visible.status === "pending_approval" &&
    canApprove &&
    visible.created_by !== me?.id;

  const canShowPublish =
    !!visible &&
    !isSupersededPublished &&
    visible.status === "approved" &&
    !visible.published_at &&
    canPublishDirect;

  const deptNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of deptsQ.data ?? []) m[d.id] = d.name;
    return m;
  }, [deptsQ.data]);

  const dailyShiftSummary = useMemo(
    () =>
      days.map((day) => ({
        day,
        label: scheduleDayLabelForDate(day, "full"),
        counts: activeShifts.map((s) => {
          const members: { employeeId: string; departmentId: string }[] = [];
          const seen = new Set<string>();
          const add = (employeeId: string, departmentId: string) => {
            if (!employeeId || !departmentId || seen.has(employeeId)) return;
            if (headcountExcludedSet.has(employeeId)) return;
            seen.add(employeeId);
            members.push({ employeeId, departmentId });
          };
          // Saved shifts from OTHER departments in this branch (already persisted).
          for (const row of weekSavedQ.data?.shifts ?? []) {
            if (row.department_id === selectedDept) continue;
            if (row.day_date === day && row.shift === s.code) {
              add(row.employee_id, row.department_id);
            }
          }
          // Current department: use the live (unsaved) edits so counters update
          // as the manager builds the schedule.
          if (selectedDept) {
            for (const emp of empsQ.data ?? []) {
              if (emp.excluded_from_schedule) continue;
              const shift = effectiveScheduleShift(emp, day, edits[emp.id]?.[day]);
              if (shift === s.code) add(emp.id, selectedDept);
            }
          }
          return { ...s, count: members.length, members };
        }),
      })),
    [days, activeShifts, empsQ.data, edits, weekSavedQ.data, selectedDept, headcountExcludedSet],
  );

  const [summaryShiftPick, setSummaryShiftPick] = useState<SummaryShiftPick | null>(null);

  const summaryMembersQ = useQuery({
    enabled: !!summaryShiftPick && summaryShiftPick.members.length > 0,
    queryKey: [
      "schedule-summary-members",
      summaryShiftPick?.members.map((m) => m.employeeId).sort().join(","),
    ],
    queryFn: async () => {
      const pick = summaryShiftPick!;
      const ids = pick.members.map((m) => m.employeeId);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      if (error) throw error;
      const nameById = new Map((data ?? []).map((p) => [p.id, p.full_name]));
      const empsById = new Map((empsQ.data ?? []).map((e) => [e.id, e.full_name]));
      return pick.members
        .map((m) => ({
          name: nameById.get(m.employeeId) ?? empsById.get(m.employeeId) ?? "—",
          department: deptNameById[m.departmentId] ?? "—",
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "he"));
    },
  });

  function openScheduleFromPending(p: {
    department_id: string;
    week_start: string;
    schedule_id?: string;
  }) {
    setSelectedDept(p.department_id);
    setWeekStart(getPeriodStart(p.week_start, periodConfig));
    setFocusedScheduleId(p.schedule_id ?? null);
    setView("editor");
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CalendarDays className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">{i18n.t("schedules.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {view === "pending" && canSeeScheduleQueues
              ? i18n.t("schedules.subtitlePending")
              : view === "approved" && canSeeScheduleQueues
              ? i18n.t("schedules.subtitleApproved")
              : view === "saved"
              ? i18n.t("schedules.subtitleSaved")
              : `${formatHeDate(weekStart)} – ${formatHeDate(weekEnd)}`}

          </p>
        </div>
      </header>

      {((canSeeScheduleQueues || canCreate) &&
        !isEmployee &&
        (canSeeScheduleQueues || !deptHeadScheduleNavBlocked)) && (
        <div className="flex gap-2 flex-wrap">
          {canSeeScheduleQueues && (
            <Button
              size="sm"
              variant={view === "pending" ? "default" : "outline"}
              onClick={() => setView("pending")}
            >
              {i18n.t("schedules.tabPending")}
              {pendingQ.data && pendingQ.data.length > 0 && (
                <Badge variant="secondary" className="mr-2">
                  {pendingQ.data.length}
                </Badge>
              )}
            </Button>
          )}
          {!deptHeadScheduleNavBlocked && (
            <Button
              size="sm"
              variant={view === "saved" ? "default" : "outline"}
              onClick={() => setView("saved")}
            >
              {i18n.t("schedules.tabSaved")}
              {branchSavedList.length > 0 && (
                <Badge variant="secondary" className="mr-2">
                  {branchSavedList.length}
                </Badge>
              )}
            </Button>
          )}
          {canSeeScheduleQueues && (
            <Button
              size="sm"
              variant={view === "approved" ? "default" : "outline"}
              onClick={() => setView("approved")}
            >
              {i18n.t("schedules.tabApproved")}
              {publishedDisplayCount > 0 && (
                <Badge variant="secondary" className="mr-2">
                  {publishedDisplayCount}
                </Badge>
              )}
            </Button>
          )}
          {!deptHeadScheduleNavBlocked && (
            <Button
              size="sm"
              variant={view === "editor" ? "default" : "outline"}
              onClick={() => {
                setFocusedScheduleId(null);
                setView("editor");
              }}
            >
              {i18n.t("schedules.tabEditor")}
            </Button>
          )}
        </div>
      )}


      {view === "saved" && !isEmployee ? (
        <div className="space-y-6">
          {branchSavedSchedulesQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : branchSavedList.length === 0 ? (
            <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
              {i18n.t("schedules.emptySaved")}
            </Card>
          ) : (
            branchSavedPeriodGroups.map((group) => {
              const periodUnpublishedCount = group.items.filter((s) =>
                isSavedScheduleAwaitingPublish(s),
              ).length;
              return (
                <div key={group.periodKey} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-semibold">
                        {i18n.t("schedules.periodGroupTitle", {
                          start: formatHeDate(group.week_start),
                          end: formatHeDate(group.week_end),
                        })}
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {i18n.t("schedules.periodSchedulesCount", { count: group.items.length })}
                      </p>
                    </div>
                    {canPublishDirect && periodUnpublishedCount > 0 && (
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={() => openPublishAllForPeriod(group.week_start)}
                        disabled={publishAllMut.isPending}
                      >
                        {publishAllMut.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                        {i18n.t("schedules.publishAll")}
                      </Button>
                    )}
                  </div>
                  <Card className="card-elevated p-0 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-right p-3">{i18n.t("schedules.colDepartment")}</th>
                          <th className="text-right p-3">{i18n.t("schedules.colDateRange")}</th>
                          <th className="text-right p-3">{i18n.t("schedules.colStatus")}</th>
                          <th className="text-right p-3">{i18n.t("schedules.colUpdated")}</th>
                          <th className="text-right p-3" />
                        </tr>
                      </thead>
                      <tbody>
                        {group.items.map((s) => (
                          <tr
                            key={s.schedule_id}
                            className="border-t hover:bg-muted/30 cursor-pointer"
                            onClick={() =>
                              openScheduleFromPending({
                                department_id: s.department_id,
                                week_start: s.week_start,
                              })
                            }
                          >
                            <td className="p-3 font-medium">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openScheduleFromPending({
                                    department_id: s.department_id,
                                    week_start: s.week_start,
                                  });
                                }}
                                className="text-primary hover:underline font-semibold"
                              >
                                {deptNameById[s.department_id] ?? "—"}
                              </button>
                            </td>
                            <td className="p-3">
                              {formatHeDate(s.week_start)} – {formatHeDate(s.week_end)}
                            </td>
                            <td className="p-3">
                              <Badge variant={STATUS_VARIANT[s.status]}>
                                {getStatusLabel(s.status)}
                              </Badge>
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">
                              {s.updated_at ? formatHeDateTime(s.updated_at) : "—"}
                            </td>
                            <td className="p-3 text-left">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  openScheduleFromPending({
                                    department_id: s.department_id,
                                    week_start: s.week_start,
                                  })
                                }
                              >
                                {i18n.t("schedules.openEdit")}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                </div>
              );
            })
          )}
        </div>
      ) : canSeeScheduleQueues && view === "pending" ? (

        <Card className="card-elevated p-0 overflow-hidden">
          {pendingQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : !pendingQ.data || pendingQ.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              {i18n.t("schedules.emptyPending")}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3">מחלקה</th>
                  <th className="text-right p-3">טווח תאריכים</th>
                  <th className="text-right p-3">נוצר ע״י</th>
                  <th className="text-right p-3">נשלח</th>
                  <th className="text-right p-3">סטטוס</th>
                  <th className="text-right p-3" />
                </tr>
              </thead>
              <tbody>
                {pendingQ.data.map((p) => (
                  <tr
                    key={p.id}
                    className="border-t hover:bg-muted/30 cursor-pointer"
                    onClick={() => openScheduleFromPending(p)}
                  >
                    <td className="p-3 font-medium">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openScheduleFromPending(p);
                        }}
                        className="text-primary hover:underline font-semibold"
                      >
                        {deptNameById[p.department_id] ?? "—"}
                      </button>
                    </td>
                    <td className="p-3">
                      {formatHeDate(p.week_start)} – {formatHeDate(p.week_end)}
                    </td>
                    <td className="p-3">
                      {pendingPeopleQ.data?.[p.created_by ?? ""] ?? "—"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {p.submitted_at ? formatHeDate(p.submitted_at) : "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant={STATUS_VARIANT[p.status]}>
                        {getStatusLabel(p.status)}
                      </Badge>
                    </td>
                    <td className="p-3 text-left">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openScheduleFromPending(p)}
                      >
                        פתח לאישור
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : canSeeScheduleQueues && view === "approved" ? (
        <div className="space-y-6">
          {approvedQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : publishedDisplayCount === 0 ? (
            <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
              {i18n.t("schedules.emptyPublished")}
            </Card>
          ) : (
            publishedPeriodGroups.map((group) => (
              <div key={group.periodKey} className="space-y-3">
                <div>
                  <h2 className="font-semibold">
                    {i18n.t("schedules.periodGroupTitle", {
                      start: formatHeDate(group.week_start),
                      end: formatHeDate(group.week_end),
                    })}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {i18n.t("schedules.periodSchedulesCount", { count: group.items.length })}
                  </p>
                </div>
                <Card className="card-elevated p-0 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-right p-3">{i18n.t("schedules.colDepartment")}</th>
                        <th className="text-right p-3">{i18n.t("schedules.colDateRange")}</th>
                        <th className="text-right p-3">{i18n.t("schedules.colCreatedBy")}</th>
                        <th className="text-right p-3">{i18n.t("schedules.colApprovedBy")}</th>
                        <th className="text-right p-3">{i18n.t("schedules.colApprovedAt")}</th>
                        <th className="text-right p-3">{i18n.t("schedules.colStatus")}</th>
                        <th className="text-right p-3" />
                      </tr>
                    </thead>
                    <tbody>
                      {group.items.map((a) => {
                        const isCurrentPublished = isDeptWideLatestPublished(
                          a,
                          latestPublishedByDept,
                        );
                        return (
                        <tr
                          key={a.id}
                          className="border-t hover:bg-muted/30 cursor-pointer"
                          onClick={() =>
                            openScheduleFromPending({
                              department_id: a.department_id,
                              week_start: a.week_start,
                              schedule_id: a.id,
                            })
                          }
                        >
                          <td className="p-3 font-medium">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openScheduleFromPending({
                                  department_id: a.department_id,
                                  week_start: a.week_start,
                                  schedule_id: a.id,
                                });
                              }}
                              className="text-primary hover:underline font-semibold"
                            >
                              {deptNameById[a.department_id] ?? "—"}
                            </button>
                          </td>
                          <td className="p-3">
                            {formatHeDate(a.week_start)} – {formatHeDate(a.week_end)}
                          </td>
                          <td className="p-3">
                            {pendingPeopleQ.data?.[a.created_by ?? ""] ?? "—"}
                          </td>
                          <td className="p-3">
                            {pendingPeopleQ.data?.[a.approved_by ?? ""] ?? "—"}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            {a.approved_at ? formatHeDateTime(a.approved_at) : "—"}
                          </td>
                          <td className="p-3">
                            <div className="flex flex-wrap gap-1">
                              <Badge variant={STATUS_VARIANT[a.status]}>
                                {getStatusLabel(a.status)}
                              </Badge>
                              {!isCurrentPublished && (
                                <Badge variant="secondary">
                                  {i18n.t("schedules.supersededBadge")}
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="p-3 text-left">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                openScheduleFromPending({
                                  department_id: a.department_id,
                                  week_start: a.week_start,
                                  schedule_id: a.id,
                                })
                              }
                            >
                              {isCurrentPublished
                                ? i18n.t("schedules.openSchedule")
                                : i18n.t("schedules.openViewOnly")}
                            </Button>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </Card>
              </div>
            ))
          )}
        </div>
      ) : (
        <>



      {!isEmployee && branchSavedList.length > 0 && !deptHeadScheduleNavBlocked && (
        <Card className="card-elevated p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {i18n.t("schedules.savedSummary", {
              count: branchSavedList.length,
              periods: branchSavedPeriodGroups.length,
            })}
          </p>
          <Button size="sm" variant="outline" onClick={() => setView("saved")}>
            {i18n.t("schedules.viewSavedSchedules")}
          </Button>
        </Card>
      )}

      <Card className="card-elevated p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        {!isEmployee && (
          <div className="flex items-center gap-2">
            {isDeptHeadOnly ? (
              <>
                <Button
                  variant={weekStart === deptHeadWeekWindow.current ? "default" : "outline"}
                  size="sm"
                  onClick={() => navigateWeek(deptHeadWeekWindow.current)}
                >
                  השבוע הזה
                </Button>
                <Button
                  variant={weekStart === deptHeadWeekWindow.next ? "default" : "outline"}
                  size="sm"
                  onClick={() => navigateWeek(deptHeadWeekWindow.next)}
                >
                  השבוע הבא
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateWeek(shiftPeriodStart(weekStart, periodConfig, -1))}
                  aria-label="שבוע קודם"
                >
                  <ChevronRight className="size-4" />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigateWeek(getPeriodStartFromDate(new Date(), periodConfig))}
                >
                  השבוע
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => navigateWeek(shiftPeriodStart(weekStart, periodConfig, 1))}
                  aria-label="שבוע הבא"
                >
                  <ChevronLeft className="size-4" />
                </Button>
              </>
            )}
          </div>
        )}

        <div className="flex-1">
          {isDeptHeadOnly ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
              {deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}
            </div>
          ) : isEmployee ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
              {deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}
            </div>
          ) : schedQ.data && canSwitchDepartments ? (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="w-full text-sm font-medium px-3 py-2 bg-muted rounded-md flex items-center justify-between gap-2 hover:bg-muted/80 transition-colors"
                >
                  <span>{deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}</span>
                  <ChevronDown className="size-4 shrink-0 opacity-60" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-80 p-0" dir="rtl">
                <div className="p-3 border-b">
                  <p className="text-xs text-muted-foreground">מחלקה נוכחית</p>
                  <p className="font-medium">{deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}</p>
                </div>
                <div className="p-2">
                  <p className="text-xs text-muted-foreground px-2 py-1">מחלקות ללא סידור שמור לשבוע זה</p>
                  {switchableDepts.length === 0 ? (
                    <p className="text-sm text-muted-foreground px-2 py-3 text-center">
                      כל שאר המחלקות כבר קיים להן סידור שמור.
                    </p>
                  ) : (
                    <ul className="max-h-56 overflow-auto">
                      {switchableDepts.map((d) => (
                        <li key={d.id}>
                          <button
                            type="button"
                            className="w-full text-right px-3 py-2.5 rounded-md hover:bg-accent transition-colors flex items-center justify-between gap-2"
                            onClick={() => selectDepartment(d.id)}
                          >
                            <span className="font-medium">{d.name}</span>
                            <Badge variant="outline" className="text-xs shrink-0">
                              {deptsWithSchedule.has(d.id) ? i18n.t("schedules.draftLabel") : i18n.t("schedules.noScheduleShort")}
                            </Badge>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          ) : schedQ.data ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
              {deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}
            </div>
          ) : (
            <Select
              value={selectedDept ?? undefined}
              onValueChange={(v) => selectDepartment(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder={i18n.t("schedules.selectDept")} />
              </SelectTrigger>
              <SelectContent>
                {(deptsQ.data ?? [])
                  .filter(
                    (d) =>
                      d.id === selectedDept || (!savedDeptSet.has(d.id) && !deptsWithSchedule.has(d.id)),
                  )
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {visible && (
          <Badge variant={STATUS_VARIANT[visible.status]} className="self-center">
            {getStatusLabel(visible.status)}
          </Badge>
        )}
      </Card>

      {/* No schedule yet */}
      {schedQ.isLoading || (isDeptHeadOnly && deptWeekFlagsQ.isLoading) ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : managerSavedDraftBlocksMe ? (
        <Card className="card-elevated p-6 border-destructive/40 bg-destructive/5">
          <div className="flex gap-3 items-start">
            <AlertTriangle className="size-5 text-destructive mt-0.5 shrink-0" />
            <div className="space-y-1.5 text-sm text-destructive">
              <p className="font-semibold text-base">
                כבר קיים סידור עבודה שמור למחלקה זו
              </p>
              <p>
                הסידור נשמר על־ידי ההנהלה וממתין לפרסום. לא ניתן ליצור סידור חדש
                עד לפרסום או מחיקת הסידור הקיים.
              </p>
              <p>
                נשמר על־ידי:{" "}
                <span className="font-medium">
                  {blockedCreatorQ.isLoading
                    ? "נטען..."
                    : (blockedCreatorQ.data ?? "לא ידוע")}
                </span>
              </p>
              <p>
                נשמר בתאריך:{" "}
                <span className="font-medium" dir="ltr">
                  {blockedSavedAt ? formatHeDateTime(blockedSavedAt) : "לא ידוע"}
                </span>
              </p>
              {blockedAwaitingStatus && (
                <p>
                  סטטוס:{" "}
                  <span className="font-medium">
                    {getStatusLabel(blockedAwaitingStatus ?? "")}
                  </span>
                </p>
              )}
            </div>
          </div>
        </Card>
      ) : !visible ? (
        <Card className="card-elevated p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {isEmployee
              ? i18n.t("schedules.noApprovedSchedule")
              : i18n.t("schedules.noSchedule")}
          </p>
          {canCreate && !isEmployee && !deptWeekFlagsQ.data?.hasSavedAwaitingPublish && (
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className="size-4 animate-spin" />}
              צור טיוטה
            </Button>
          )}
        </Card>
      ) : (
        <>
          {isSupersededPublished && (
            <Card className="card-elevated p-4 border-amber-500/40 bg-amber-500/5">
              <div className="flex gap-3 items-start text-sm">
                <AlertTriangle className="size-5 text-amber-600 mt-0.5 shrink-0" />
                <p>{i18n.t("schedules.supersededViewOnly")}</p>
              </div>
            </Card>
          )}

          {/* Actor info: creator + editor + approver */}
          <Card className="card-elevated p-4 space-y-2">
            <SchedulePersonMetaRow
              label={i18n.t("schedules.createdBy")}
              person={decisionPersonQ.data?.creator ?? null}
              fallback={decisionPersonQ.isLoading ? i18n.t("schedules.loading") : i18n.t("schedules.unknown")}
            />
            <SchedulePersonMetaRow
              label={i18n.t("schedules.editedBy")}
              person={decisionPersonQ.data?.editor ?? null}
              className="text-amber-700 dark:text-amber-400"
              fallback={decisionPersonQ.isLoading ? i18n.t("schedules.loading") : i18n.t("schedules.unknown")}
            />
            <SchedulePersonMetaRow
              label={i18n.t("schedules.approvedBy")}
              person={decisionPersonQ.data?.approver ?? null}
              className="text-emerald-700 dark:text-emerald-400"
              fallback={visible.status === "approved" ? (decisionPersonQ.isLoading ? i18n.t("schedules.loading") : i18n.t("schedules.unknown")) : i18n.t("schedules.notApproved")}
            />
          </Card>

          {isDraftLockedForMe ? (
            <Card className="card-elevated p-6 border-primary/30 bg-primary/5">
              <div className="flex gap-3 items-start">
                <AlertTriangle className="size-5 text-primary mt-0.5 shrink-0" />
                <div className="space-y-1.5 text-sm">
                  <p className="font-semibold text-base">
                    כבר קיים סידור עבודה שמור למחלקה זו
                  </p>
                  <p>
                    נשמר על־ידי:{" "}
                    <span className="font-medium">
                      {decisionPersonQ.data?.creator?.full_name ?? "לא ידוע"}
                    </span>
                  </p>
                  <p>
                    נשמר בתאריך:{" "}
                    <span className="font-medium" dir="ltr">
                      {blockedSavedAt ? formatHeDateTime(blockedSavedAt) : "לא ידוע"}
                    </span>
                  </p>
                  <p>
                    סטטוס:{" "}
                    <span className="font-medium">
                      {getStatusLabel(visible.status)}
                    </span>
                  </p>
                  <p className="text-muted-foreground">
                    רק יוצר הטיוטה או בעל הרשאה מתאימה יכול לערוך או לפרסם אותה.
                  </p>
                </div>
              </div>
            </Card>
          ) : (
            <>
          {(visible.status === "rejected" || visible.status === "approved") && (
            <Card
              className={`card-elevated p-4 ${
                visible.status === "rejected"
                  ? "border-destructive/40 bg-destructive/5"
                  : "border-emerald-500/40 bg-emerald-500/5"
              }`}
            >
              <div className="flex gap-2 items-start">
                {visible.status === "rejected" ? (
                  <AlertTriangle className="size-4 text-destructive mt-0.5" />
                ) : decisionPersonQ.data?.editedBeforeApproval ? (
                  <span className="mt-0.5">✏️</span>
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-600 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm">
                    {visible.status === "rejected"
                      ? i18n.t("schedules.statusRejectedMsg")
                      : !visible.published_at
                        ? i18n.t("schedules.statusApprovedPending")
                        : decisionPersonQ.data?.editedBeforeApproval
                          ? i18n.t("schedules.statusPublished")
                          : i18n.t("schedules.statusApprovedPublished")}
                  </p>
                  <div className="text-xs text-muted-foreground mt-1 space-y-0.5">
                    <p>
                      {visible.status === "rejected"
                        ? "❌ נדחה על ידי: "
                        : decisionPersonQ.data?.editedBeforeApproval
                          ? "✏️ נערך ואושר על ידי: "
                          : "✅ אושר על ידי: "}
                      <span className="font-medium text-foreground">
                        👤 {decisionPersonQ.data?.full_name ?? "—"}
                      </span>
                      {decisionPersonQ.data?.role_label && (
                        <span className="text-muted-foreground"> · 💼 {decisionPersonQ.data.role_label}</span>
                      )}
                      {decisionPersonQ.data?.job_title && (
                        <span className="text-muted-foreground"> ({decisionPersonQ.data.job_title})</span>
                      )}
                    </p>
                    <p>
                      📅🕒 תאריך ושעה:{" "}
                      <span className="font-medium text-foreground">
                        {decisionPersonQ.data?.at ? formatHeDateTime(decisionPersonQ.data.at) : "—"}
                      </span>
                    </p>
                  </div>
                  {visible.status === "rejected" && visible.rejection_note && (
                    <p className="text-sm mt-2 p-2 rounded bg-background/60 border border-destructive/20">
                      <span className="font-semibold">סיבת דחייה: </span>
                      {visible.rejection_note}
                    </p>
                  )}

                </div>
              </div>
            </Card>
          )}

          {/* Draft / pre-publication summary for authorized managers only */}
          {canViewPrePublishSummary && visible.status !== "rejected" && (visible.status !== "approved" || !visible.published_at) && (
            <Card className="card-elevated p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div>
                  <h3 className="font-semibold flex items-center gap-2">
                    <CalendarDays className="size-4" />
                    סיכום סידור — {visible.status === "approved" ? "מאושר וממתין לפרסום" : visible.status === "pending_approval" ? "ממתין לאישור" : "טיוטה"}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {visible.status === "approved"
                      ? "בדוק את סיכום העובדים לפי יום ומשמרת לפני הפרסום. הסידור עדיין מוסתר מעובדים ואחראי מחלקות."
                      : visible.status === "pending_approval"
                        ? "בדוק את הסיכום לפני האישור. עובדים ואחראי מחלקות לא רואים את הסידור עד לפרסום."
                        : canPublishDirect ? "הסידור שמור כטיוטה ומוסתר מעובדים ואחראי מחלקות. לחץ \"פרסם סידור עבודה\" כדי לאשר ולפרסם אותו בלחיצה אחת." : "הסידור שמור כטיוטה ומוסתר מעובדים ואחראי מחלקות. לחץ \"שלח לאישור\" בסיום."}
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                {dailyShiftSummary.map((day) => (
                  <div key={day.day} className="rounded-lg border bg-background/60 p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <p className="font-semibold text-sm">יום {day.label}</p>
                      <p className="text-xs text-muted-foreground">{formatHeDate(day.day)}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {day.counts.map((s) => (
                        <button
                          key={`${day.day}-${s.code}`}
                          type="button"
                          onClick={() =>
                            setSummaryShiftPick({
                              day: day.day,
                              dayLabel: day.label,
                              shiftName: s.name,
                              members: s.members,
                            })
                          }
                          className="px-3 py-1.5 rounded-md text-sm font-medium border text-start cursor-pointer hover:opacity-90 hover:ring-1 hover:ring-primary/40 transition"
                          style={shiftStyle(s.code)}
                          title="לחץ להצגת השמות"
                        >
                          <span
                            className="inline-block size-2 rounded-full me-2 align-middle"
                            style={{ backgroundColor: s.color }}
                          />
                          {s.name}: <strong>{s.count}</strong> עובדים
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Actions bar */}
          <div className="flex flex-wrap gap-2">
            {editable && canEditScheduleTimes && (visible.status === "approved" || visible.status === "pending_approval") && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
                {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                שמור שינויים
              </Button>
            )}
            {editable && visible.status !== "approved" && visible.status !== "pending_approval" && (
              <>
                {canSaveScheduleDraft && (
                  <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
                    {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    שמור טיוטה
                  </Button>
                )}
                <Button
                  onClick={() => submitMut.mutate()}
                  disabled={submitMut.isPending}
                  size="sm"
                  variant="default"
                >
                  {submitMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {canPublishDirect ? i18n.t("schedules.publish") : i18n.t("schedules.sendForApproval")}
                </Button>

                <Button
                  onClick={() => setCopyOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  <Copy className="size-4" />
                  העתק מהשבוע הקודם
                </Button>
              </>
            )}

            {canShowApprove && (
              <Button
                onClick={() => approveMut.mutate()}
                disabled={approveMut.isPending || saveMut.isPending}
                size="sm"
                variant="default"
              >
                {approveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : canPublishDirect ? <Send className="size-4" /> : <CheckCircle2 className="size-4" />}
                {canPublishDirect ? i18n.t("schedules.publish") : i18n.t("schedules.approveSchedule")}
              </Button>
            )}
            {canShowPublish && (
              <Button
                onClick={() => publishMut.mutate()}
                disabled={publishMut.isPending || saveMut.isPending}
                size="sm"
                variant="default"
              >
                {publishMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                פרסם סידור עבודה
              </Button>
            )}
            {canDelete && (
              <Button
                onClick={() => setDeleteOpen(true)}
                size="sm"
                variant="destructive"
              >
                <Trash2 className="size-4" />
                מחק סידור
              </Button>
            )}
          </div>

          {/* Grid */}
          <Card className="card-elevated p-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3 sticky right-0 bg-muted/50 z-10 min-w-[160px]">
                    עובד
                  </th>
                  {days.map((d, dayIdx) => {
                    const dayCounts = dailyShiftSummary[dayIdx]?.counts ?? [];
                    return (
                      <th key={d} className="p-2 text-center min-w-[110px] align-top">
                        <div className="font-semibold">{scheduleDayLabelForDate(d, "short")}</div>
                        <div className="text-xs text-muted-foreground">{formatHeDate(d)}</div>
                        {dayCounts.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 justify-center">
                            {dayCounts.map((s) => (
                              <button
                                key={`hdr-${d}-${s.code}`}
                                type="button"
                                onClick={() =>
                                  setSummaryShiftPick({
                                    day: d,
                                    dayLabel: scheduleDayLabelForDate(d, "full"),
                                    shiftName: s.name,
                                    members: s.members,
                                  })
                                }
                                className="px-1.5 py-0.5 rounded text-[10px] font-medium border leading-none cursor-pointer hover:opacity-80 hover:ring-1 hover:ring-primary/40 transition"
                                style={shiftStyle(s.code)}
                                title={`${s.name}: ${s.count} — לחץ להצגת השמות`}
                              >
                                {s.name} ({s.count})
                              </button>
                            ))}
                          </div>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {(empsQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      אין עובדים פעילים במחלקה זו.
                    </td>
                  </tr>
                )}
                {(empsQ.data ?? []).map((emp) => (
                  <tr
                    key={emp.id}
                    className={`border-t ${emp.excluded_from_schedule ? "bg-muted/20" : ""}`}
                  >
                    <td className="p-3 sticky right-0 bg-card font-medium z-[1]">
                      <div className="flex items-center gap-2 justify-end min-w-0">
                        <span className="min-w-0 truncate">{emp.full_name}</span>
                        {emp.excluded_from_schedule && (
                          <Badge variant="outline" className="text-[10px] shrink-0 rounded-full">
                            לא בסידור
                          </Badge>
                        )}
                        {emp.on_leave && days.some((d) => isEmployeeOnLeaveOnDate(emp, d)) && (
                          <Badge variant="secondary" className="text-[10px] shrink-0 rounded-full">
                            בחופש
                          </Badge>
                        )}
                        {canToggleScheduleExclusion && emp.id !== me?.id && (
                          <Button
                            type="button"
                            variant={emp.excluded_from_schedule ? "secondary" : "ghost"}
                            size="icon"
                            className="size-7 shrink-0"
                            disabled={exclusionMut.isPending}
                            title={
                              emp.excluded_from_schedule
                                ? "כלול בסידור עבודה"
                                : "לא נכלל בסידור עבודה"
                            }
                            aria-label={
                              emp.excluded_from_schedule
                                ? "כלול בסידור עבודה"
                                : "לא נכלל בסידור עבודה"
                            }
                            onClick={() =>
                              exclusionMut.mutate({
                                user_id: emp.id,
                                excluded: !emp.excluded_from_schedule,
                              })
                            }
                          >
                            <UserX className="size-3.5" />
                          </Button>
                        )}
                      </div>
                    </td>
                    {days.map((day) => {
                      const excluded = !!emp.excluded_from_schedule;
                      const onLeaveDay = isEmployeeOnLeaveOnDate(emp, day);
                      const cur = effectiveScheduleShift(emp, day, edits[emp.id]?.[day]) as
                        | Shift
                        | undefined;
                      const baselineKey = `${emp.id}|${day}`;
                      const cellLeaveType =
                        leaveTypeByCell[baselineKey] ??
                        (onLeaveDay ? ((emp as any).leave_type_code as string | null) : null) ??
                        null;
                      const cellShiftLabel =
                        cur === "off"
                          ? leaveOffLabel(cellLeaveType)
                          : cur
                            ? shiftLabel(cur)
                            : "";
                      const def = cur ? shiftDefsQ.map.get(cur) : undefined;
                      const defTimes = cur ? shiftDefsQ.getTimesForDay(cur, day) : { start_time: null, end_time: null };
                      const defStart = hmFromValue(defTimes.start_time);
                      const defEnd = hmFromValue(defTimes.end_time);
                      const cellTimes = timeEdits[emp.id]?.[day];
                      const { start: effStart, end: effEnd } = resolveEffectiveCellTimes(
                        cellTimes,
                        defStart,
                        defEnd,
                      );
                      const timeDisplay = formatShiftTimeRange(effStart, effEnd);
                      const showEndField = effEnd !== null || defEnd !== null;
                      const showTimeRow =
                        !!cur &&
                        cur !== "off" &&
                        !!(timeDisplay || defTimes.start_time || defTimes.end_time);
                      const effNote = noteEdits[emp.id]?.[day] ?? null;
                      const {
                        isShiftModified,
                        isTimeModified,
                        isNoteModified,
                      } = diffScheduleCellForViewer({
                        currentShift: cur ?? null,
                        currentStart: effStart,
                        currentEnd: effEnd,
                        currentNote: effNote,
                        baselineKind: changeBaselineKind,
                        submittedBaseline: changeBaselineSubmitted[baselineKey],
                        publishedBaseline: changeBaselinePublished[baselineKey],
                        currentShiftDef: def,
                        includeSubmittedDiffWhenPublished,
                      });
                      if (!editable || excluded || onLeaveDay) {
                        return (
                          <td key={day} className="p-2 text-center align-top">
                            <div className="relative inline-block">
                              {cur && !excluded ? (
                                <>
                                  <span
                                    className={`inline-block px-2 py-1 rounded-md text-xs font-medium border ${
                                      isShiftModified ? "ring-2 ring-orange-500 border-orange-500" : ""
                                    }`}
                                    style={shiftStyle(cur)}
                                  >
                                    {cellShiftLabel}
                                  </span>
                                  {timeDisplay && (
                                    <div
                                      className={`inline-flex items-center justify-center gap-1 mt-1 text-[10px] text-muted-foreground tabular-nums rounded px-1 ${
                                        isTimeModified ? "ring-2 ring-orange-500" : ""
                                      }`}
                                      dir="ltr"
                                    >
                                      <span>{timeDisplay}</span>
                                      {isTimeModified && (
                                        <RefreshCw
                                          className="size-3 shrink-0 text-orange-600"
                                          aria-label="שעות עודכנו לאחר פרסום"
                                        />
                                      )}
                                    </div>
                                  )}
                                  <ScheduleShiftNote
                                    note={effNote}
                                    editable={false}
                                    modified={isNoteModified}
                                  />
                                </>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                              {isShiftModified && (
                                <RefreshCw
                                  className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                                  aria-label="משמרת עודכנה לאחר פרסום"
                                />
                              )}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={day} className="p-2 align-top">
                          <div className="relative space-y-1">
                            <Select
                              value={
                                cur === "off"
                                  ? "off:regular"
                                  : (cur ?? "")
                              }
                              onValueChange={(v) => setShift(emp.id, day, v)}
                            >
                              <SelectTrigger
                                className={`h-9 ${
                                  isShiftModified ? "ring-2 ring-orange-500 border-orange-500" : ""
                                }`}
                                style={cur ? shiftStyle(cur) : undefined}
                              >
                                <SelectValue placeholder="—">
                                  {cur ? cellShiftLabel : "—"}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {activeShifts.flatMap((s) => {
                                  if (s.code === "off") {
                                    return [
                                      <SelectItem key="off:regular" value="off:regular">
                                        <span
                                          className="inline-block size-2 rounded-full me-2 align-middle"
                                          style={{ backgroundColor: s.color }}
                                        />
                                        חופש רגיל
                                      </SelectItem>,
                                    ];
                                  }
                                  return [
                                    <SelectItem key={s.code} value={s.code}>
                                      <span
                                        className="inline-block size-2 rounded-full me-2 align-middle"
                                        style={{ backgroundColor: s.color }}
                                      />
                                      {s.name}
                                    </SelectItem>,
                                  ];
                                })}
                              </SelectContent>
                            </Select>
                            {showTimeRow && (
                              canEditScheduleTimes ? (
                                <div className="flex items-center gap-1" dir="ltr">
                                  <div
                                    className={`flex flex-1 items-center gap-1 rounded-md ${
                                      isTimeModified ? "ring-2 ring-orange-500 p-0.5" : ""
                                    }`}
                                  >
                                    <Time24Input
                                      aria-label="שעת התחלה"
                                      value={effStart ?? ""}
                                      onChange={(v) => setCellTime(emp.id, day, "start", v)}
                                      className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                    {showEndField && (
                                      <>
                                        <span className="text-[10px] text-muted-foreground">–</span>
                                        <Time24Input
                                          aria-label="שעת סיום"
                                          value={effEnd ?? ""}
                                          onChange={(v) => setCellTime(emp.id, day, "end", v)}
                                          className="h-7 w-full min-w-0 rounded-md border border-input bg-background px-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-ring"
                                        />
                                      </>
                                    )}
                                  </div>
                                  {isTimeModified && (
                                    <RefreshCw
                                      className="size-3 shrink-0 text-orange-600"
                                      aria-label="שעות עודכנו לאחר פרסום"
                                    />
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="text-[10px] text-muted-foreground text-center tabular-nums mt-0.5"
                                  dir="ltr"
                                >
                                  {timeDisplay}
                                </div>
                              )
                            )}
                            <ScheduleShiftNote
                              note={effNote}
                              editable={canEditScheduleTimes && !!cur && cur !== "off"}
                              modified={isNoteModified}
                              onChange={(v) => setCellNote(emp.id, day, v)}
                            />
                            {isShiftModified && (
                              <RefreshCw
                                className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                                aria-label="משמרת עודכנה לאחר פרסום"
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
            </>
          )}
        </>
      )}
        </>
      )}



      <AlertDialog open={copyOpen} onOpenChange={setCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>להעתיק מהשבוע הקודם?</AlertDialogTitle>
            <AlertDialogDescription>
              כל השיבוצים הנוכחיים בטיוטה יוחלפו בשיבוצי השבוע הקודם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => copyMut.mutate()}>העתק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={publishAllOpen} onOpenChange={setPublishAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>פרסום כל סידורי העבודה</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t("schedules.publishPeriodBanner", {
                start: formatHeDate(publishPeriodWeekStart),
                end: formatHeDate(
                  branchSavedPeriodGroups.find((g) => g.week_start === publishPeriodWeekStart)
                    ?.week_end ?? addDaysISO(publishPeriodWeekStart, 6),
                ),
                count: publishPeriodUnpublishedCount,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                publishAllMut.mutate();
              }}
              disabled={publishAllMut.isPending}
            >
                  {publishAllMut.isPending ? <Loader2 className="size-4 animate-spin" /> : i18n.t("schedules.publishShort")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>האם אתה בטוח שברצונך למחוק את סידור העבודה?</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק את כל השיבוצים, ההיסטוריה וההתראות של הסידור לצמיתות. לאחר המחיקה ניתן יהיה ליצור סידור חדש לאותה מחלקה ולאותו שבוע.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMut.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!summaryShiftPick} onOpenChange={(open) => !open && setSummaryShiftPick(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {summaryShiftPick
                ? `יום ${summaryShiftPick.dayLabel} · ${summaryShiftPick.shiftName}`
                : "עובדים במשמרת"}
            </DialogTitle>
            {summaryShiftPick && (
              <DialogDescription>
                {formatHeDate(summaryShiftPick.day)} · {summaryShiftPick.members.length} עובדים
              </DialogDescription>
            )}
          </DialogHeader>
          {summaryMembersQ.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : (summaryMembersQ.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              אין עובדים משובצים במשמרת זו.
            </p>
          ) : (
            <ul className="divide-y max-h-[50vh] overflow-auto">
              {(summaryMembersQ.data ?? []).map((row, i) => (
                <li key={i} className="py-2.5 flex items-center justify-between gap-3">
                  <span className="font-medium">{row.name}</span>
                  <span className="text-sm text-muted-foreground shrink-0">{row.department}</span>
                </li>
              ))}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSummaryShiftPick(null)}>
              סגור
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ScheduleShiftNote({
  note,
  editable,
  modified = false,
  onChange,
}: {
  note: string | null | undefined;
  editable: boolean;
  modified?: boolean;
  onChange?: (value: string) => void;
}) {
  const trimmed = note?.trim() ?? "";
  const modifiedRing = modified ? "ring-2 ring-orange-500 rounded px-0.5" : "";
  if (!editable && !trimmed) return null;
  if (!editable) {
    return (
      <p
        className={`text-[10px] text-red-600 mt-0.5 truncate max-w-[5.5rem] mx-auto text-center font-medium ${modifiedRing}`}
        title={trimmed}
      >
        {trimmed}
      </p>
    );
  }
  if (!trimmed) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="mt-0.5 flex justify-center w-full text-muted-foreground hover:text-foreground"
            aria-label="הוסף הערה"
          >
            <MessageSquare className="size-3" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-44 p-2" align="center">
          <Input
            maxLength={SCHEDULE_NOTE_MAX}
            value=""
            onChange={(e) => onChange?.(e.target.value.slice(0, SCHEDULE_NOTE_MAX))}
            placeholder={`הערה (עד ${SCHEDULE_NOTE_MAX})`}
            className="h-8 text-xs"
          />
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`mt-0.5 w-full text-[10px] text-red-600 hover:text-red-700 font-medium truncate max-w-[5.5rem] mx-auto block text-center ${modifiedRing}`}
          title={trimmed}
        >
          {trimmed}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-2" align="center">
        <Input
          maxLength={SCHEDULE_NOTE_MAX}
          value={trimmed}
          onChange={(e) => onChange?.(e.target.value.slice(0, SCHEDULE_NOTE_MAX))}
          placeholder={`הערה (עד ${SCHEDULE_NOTE_MAX})`}
          className="h-8 text-xs"
        />
      </PopoverContent>
    </Popover>
  );
}
