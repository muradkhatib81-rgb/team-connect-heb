import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import { z } from "zod";
import { isEmployeeOnLeaveOnDate } from "@/lib/employee-leave";
import {
  canEditScheduleTimes,
  resolveScheduleManagerCaps,
} from "@/lib/schedule-manager-caps";
import {
  canViewScheduleContent,
  isBranchLevelScheduleViewer,
  isDeptHeadEditableDraft,
  isDeptHeadSubmittedAwaitingApproval,
  isManagerSavedScheduleForDeptHead,
  isSavedScheduleAwaitingPublish,
  type ScheduleViewerCaps,
} from "@/lib/schedule-visibility";
import { resolveScheduleChangeBaselineKind } from "@/lib/schedule-publish-diff";
import { SCHEDULE_NOTE_MAX, trimScheduleNote } from "@/lib/schedule-note";
import {
  enforceSupersededPublishedSchedulePolicy,
} from "@/lib/schedule-superseded";
import { pushForScheduleNotification } from "@/lib/push-dispatch.server";
import {
  buildPeriodDays,
  filterPeriodCalendarDays,
  getConfiguredWeekDows,
  getPeriodEnd,
  getPeriodStart,
  getReferencePeriodStart,
  shiftPeriodStart,
  utcDowFromSaturday,
  type BranchPeriodConfig,
  type ScheduleDow,
} from "@/lib/schedule-period-config";
import { fetchSchedulePeriodConfig } from "@/lib/schedule-period-settings";

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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

async function fetchBranchPeriodConfig(
  supabase: any,
  branchId: string | null = null,
): Promise<BranchPeriodConfig> {
  return fetchSchedulePeriodConfig(supabase, branchId);
}

function scheduleLastDay(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
): string {
  const days = weekDaysOfSchedule(sched, config);
  return days[days.length - 1] ?? sched.week_end ?? getPeriodEnd(getPeriodStart(sched.week_start, config), config);
}

function scheduleIsActiveOrUpcoming(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
  todayIso: string,
): boolean {
  return scheduleLastDay(sched, config) >= todayIso;
}

function addScheduleDisplayDays(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
  displayDaysSet: Set<string>,
): void {
  for (const day of weekDaysOfSchedule(sched, config)) {
    displayDaysSet.add(day);
  }
}

function periodBoundsOf(dateStr: string, config: BranchPeriodConfig): { start: string; end: string } {
  const start = getPeriodStart(dateStr, config);
  const end = getPeriodEnd(start, config);
  return { start, end };
}

// Shift codes are dynamic — validated against public.shift_definitions at runtime.
const shiftCode = z.string().min(1).max(64);

async function getCaps(supabase: any, userId: string) {
  const [{ data: roles }, { data: perm }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("user_task_permissions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("department_id").eq("id", userId).maybeSingle(),
  ]);
  const roleList = (roles ?? []).map((r: any) => r.role as string);
  const p: any = perm ?? {};
  return {
    ...resolveScheduleManagerCaps(roleList, p),
    departmentId: profile?.department_id ?? null,
  };
}

/** Manual schedule offs are always regular; sick only from employee leave profile. */
function normalizeManualOffLeaveTypes<
  T extends {
    employee_id: string;
    day_date: string;
    shift: string;
    leave_type_code?: string | null;
  },
>(deptEmployees: any[], shifts: T[]): T[] {
  return shifts.map((s) => {
    if (s.shift !== "off") return { ...s, leave_type_code: null };
    const emp = deptEmployees.find((e: any) => e.id === s.employee_id);
    if (emp && isEmployeeOnLeaveOnDate(emp, s.day_date)) {
      return {
        ...s,
        leave_type_code: emp.leave_type_code ?? s.leave_type_code ?? "regular",
      };
    }
    return { ...s, leave_type_code: "regular" };
  });
}

async function getDepartmentScheduleEmployees(supabase: any, departmentId: string) {
  const [{ data: emps }, { data: dept }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, is_active, excluded_from_schedule, on_leave, leave_start_date, leave_end_date, leave_type_code")
      .eq("department_id", departmentId)
      .eq("is_active", true),
    supabase
      .from("departments")
      .select("manager_id, code")
      .eq("id", departmentId)
      .maybeSingle(),
  ]);

  const rows = [...(emps ?? [])];
  const includeDeptHead =
    !!dept?.manager_id && dept?.code !== "management";
  if (includeDeptHead && !rows.some((e: any) => e.id === dept!.manager_id)) {
    const { data: mgr } = await supabase
      .from("profiles")
      .select("id, full_name, department_id, is_active, excluded_from_schedule, on_leave, leave_start_date, leave_end_date, leave_type_code")
      .eq("id", dept.manager_id)
      .eq("department_id", departmentId)
      .eq("is_active", true)
      .maybeSingle();
    if (mgr) rows.push(mgr as any);
  }
  return rows;
}

function schedulableDepartmentEmployees(employees: any[]) {
  return (employees ?? []).filter((e: any) => !e.excluded_from_schedule);
}

function weekDaysOfSchedule(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
): string[] {
  if (sched.week_end) {
    const calendarDays = buildDaysBetween(sched.week_start, sched.week_end);
    const isMonthly = (sched.schedule_type ?? config.schedule_type) === "monthly";
    if (isMonthly) return filterPeriodCalendarDays(calendarDays, config);
    const allowed = new Set(getConfiguredWeekDows(config.week_start_dow, config.week_end_dow));
    return calendarDays.filter((iso) => allowed.has(utcDowFromSaturday(iso) as ScheduleDow));
  }
  return buildPeriodDays(getPeriodStart(sched.week_start, config), config);
}

/** Force חופש (off) on leave days before save/submit validation. */
function applyLeaveOffToShifts(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
  deptEmployees: any[],
  shifts: {
    employee_id: string;
    day_date: string;
    shift: string;
    start_time?: string | null;
    end_time?: string | null;
    leave_type_code?: string | null;
  }[],
) {
  const schedulable = schedulableDepartmentEmployees(deptEmployees);
  const days = weekDaysOfSchedule(sched, config);
  const byCell = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) byCell.set(`${s.employee_id}|${s.day_date}`, s);
  for (const emp of schedulable) {
    for (const day of days) {
      if (!isEmployeeOnLeaveOnDate(emp, day)) continue;
      const key = `${emp.id}|${day}`;
      const prev = byCell.get(key);
      byCell.set(key, {
        ...(prev ?? { employee_id: emp.id, day_date: day }),
        employee_id: emp.id,
        day_date: day,
        shift: "off",
        start_time: null,
        end_time: null,
        leave_type_code: emp.leave_type_code ?? prev?.leave_type_code ?? "regular",
      });
    }
  }
  return [...byCell.values()];
}

/** Unset cells → חופש (off). Chosen morning/evening/off are kept. */
function applyEmptyOffToShifts(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
  deptEmployees: any[],
  shifts: {
    employee_id: string;
    day_date: string;
    shift: string;
    start_time?: string | null;
    end_time?: string | null;
    note?: string | null;
  }[],
) {
  const schedulable = schedulableDepartmentEmployees(deptEmployees);
  const days = weekDaysOfSchedule(sched, config);
  const byCell = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) byCell.set(`${s.employee_id}|${s.day_date}`, s);
  for (const emp of schedulable) {
    for (const day of days) {
      const key = `${emp.id}|${day}`;
      if (byCell.has(key)) continue;
      byCell.set(key, {
        employee_id: emp.id,
        day_date: day,
        shift: "off",
        start_time: null,
        end_time: null,
        note: null,
      });
    }
  }
  return [...byCell.values()];
}

function applyLeaveOffToShiftMap(
  sched: { week_start: string; week_end?: string | null; schedule_type?: string | null },
  config: BranchPeriodConfig,
  deptEmployees: any[],
  map: Map<string, Map<string, string[]>>,
) {
  const schedulable = schedulableDepartmentEmployees(deptEmployees);
  const days = weekDaysOfSchedule(sched, config);
  for (const emp of schedulable) {
    let m = map.get(emp.id);
    if (!m) {
      m = new Map();
      map.set(emp.id, m);
    }
    for (const day of days) {
      if (isEmployeeOnLeaveOnDate(emp, day)) m.set(day, ["off"]);
    }
  }
}


function scheduleCellSaveSignature(s: {
  employee_id: string;
  day_date: string;
  shift: string;
  start_time?: string | null;
  end_time?: string | null;
  note?: string | null;
}): string {
  const hm = (v: string | null | undefined) => {
    if (!v) return "";
    return String(v).trim().slice(0, 5);
  };
  const note = trimScheduleNote(s.note);
  return `${s.employee_id}|${s.day_date}|${s.shift}|${hm(s.start_time)}|${hm(s.end_time)}|${note}`;
}

async function getScheduleDepartmentRecipientIds(
  supabase: any,
  departmentId: string,
  excludeUserId?: string | null,
): Promise<string[]> {
  const [{ data: emps }, { data: dept }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .eq("department_id", departmentId)
      .eq("is_active", true),
    supabase.from("departments").select("manager_id, code").eq("id", departmentId).maybeSingle(),
  ]);
  const ids = new Set<string>((emps ?? []).map((e: any) => e.id as string));
  if (dept?.manager_id && dept.code !== "management") ids.add(dept.manager_id as string);
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

async function notifyScheduleDepartment(
  supabase: any,
  scheduleId: string,
  departmentId: string,
  message: string,
  excludeUserId?: string | null,
) {
  const recipientIds = await getScheduleDepartmentRecipientIds(
    supabase,
    departmentId,
    excludeUserId,
  );
  if (!recipientIds.length) return;
  await supabase.from("schedule_notifications").insert(
    recipientIds.map((uid) => ({
      schedule_id: scheduleId,
      user_id: uid,
      message,
    })),
  );
  // Must await on serverless — fire-and-forget often dies before the push is sent.
  await pushForScheduleNotification({ userIds: recipientIds, message, scheduleId });
}

async function snapshotSubmittedShifts(supabase: any, scheduleId: string) {
  const { data: cur, error } = await supabase
    .from("schedule_shifts")
    .select("*")
    .eq("schedule_id", scheduleId);
  if (error) throw new Error(error.message);
  if (!cur?.length) return;
  // One upsert instead of N sequential updates (was the main publish slowdown).
  const { error: upErr } = await supabase.from("schedule_shifts").upsert(
    (cur as Record<string, unknown>[]).map((row) => ({
      ...row,
      submitted_shift: row.shift,
      submitted_start_time: (row.start_time as string | null) ?? null,
      submitted_end_time: (row.end_time as string | null) ?? null,
      submitted_note: (row.note as string | null) ?? null,
    })),
  );
  if (upErr) throw new Error(upErr.message);
}

async function snapshotPublishedShifts(supabase: any, scheduleId: string) {
  const { data: cur, error } = await supabase
    .from("schedule_shifts")
    .select("*")
    .eq("schedule_id", scheduleId);
  if (error) throw new Error(error.message);
  if (!cur?.length) return;
  // One upsert instead of N sequential updates (was the main publish slowdown).
  const { error: upErr } = await supabase.from("schedule_shifts").upsert(
    (cur as Record<string, unknown>[]).map((row) => ({
      ...row,
      published_shift: row.shift,
      published_start_time: (row.start_time as string | null) ?? null,
      published_end_time: (row.end_time as string | null) ?? null,
      published_note: (row.note as string | null) ?? null,
    })),
  );
  if (upErr) throw new Error(upErr.message);
}

// Normalize a date to the start/end of the branch schedule period.
function weekStartOf(dateStr: string, config: BranchPeriodConfig): { start: string; end: string } {
  return periodBoundsOf(dateStr, config);
}

/** Match a department schedule row to the normalized period (handles legacy week_start keys). */
function scheduleMatchesPeriod(
  row: { week_start: string; week_end?: string | null },
  periodStart: string,
  periodEnd: string,
  config: BranchPeriodConfig,
): boolean {
  const norm = weekStartOf(row.week_start, config).start;
  if (norm === periodStart) return true;
  // Legacy: week_start stored as any day inside the same period window.
  if (row.week_start >= periodStart && row.week_start <= periodEnd) return true;
  // Sat-keyed rows for Sun–Fri periods (week_start = day before periodStart).
  if (
    row.week_start === addDaysISO(periodStart, -1) &&
    (row.week_end == null || row.week_end >= periodStart)
  ) {
    return true;
  }
  // Calendar overlap with the requested period window.
  if (
    row.week_end &&
    row.week_start <= periodEnd &&
    row.week_end >= periodStart &&
    (norm === periodStart || row.week_start === addDaysISO(periodStart, -1))
  ) {
    return true;
  }
  return false;
}

/** All schedules for one department + normalized period (handles legacy week_start keys). */
async function findAllDepartmentSchedulesForPeriod(
  supabase: any,
  departmentId: string,
  periodStart: string,
  periodEnd: string,
  config: BranchPeriodConfig,
): Promise<Record<string, unknown>[]> {
  const legacyStart = addDaysISO(periodStart, -1);
  // One query covers exact start, in-period starts, Sat-keyed legacy, and week_end overlap.
  // (Previously 5 sequential queries + a branch-wide shift scan — that made the app crawl.)
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("department_id", departmentId)
    .or(
      [
        `and(week_start.gte.${legacyStart},week_start.lte.${periodEnd})`,
        `and(week_start.lte.${periodEnd},week_end.gte.${periodStart})`,
      ].join(","),
    );
  if (error) throw error;

  const seen = new Set<string>();
  const matches: Record<string, unknown>[] = [];
  for (const row of data ?? []) {
    const id = (row as { id?: string }).id;
    if (!id || seen.has(id)) continue;
    if (
      !scheduleMatchesPeriod(
        row as { week_start: string; week_end?: string | null },
        periodStart,
        periodEnd,
        config,
      )
    ) {
      continue;
    }
    seen.add(id);
    matches.push(row as Record<string, unknown>);
  }
  return matches;
}

/** Batch period lookup for many departments — one schedules query instead of N×findAll. */
async function findSchedulesForDepartmentsInPeriod(
  supabase: any,
  departmentIds: string[],
  periodStart: string,
  periodEnd: string,
  config: BranchPeriodConfig,
): Promise<Map<string, Record<string, unknown>[]>> {
  const byDept = new Map<string, Record<string, unknown>[]>();
  if (!departmentIds.length) return byDept;

  const legacyStart = addDaysISO(periodStart, -1);
  const { data, error } = await supabase
    .from("schedules")
    .select("*")
    .in("department_id", departmentIds)
    .or(
      [
        `and(week_start.gte.${legacyStart},week_start.lte.${periodEnd})`,
        `and(week_start.lte.${periodEnd},week_end.gte.${periodStart})`,
      ].join(","),
    );
  if (error) throw error;

  for (const row of data ?? []) {
    const deptId = (row as { department_id?: string }).department_id;
    if (!deptId) continue;
    if (
      !scheduleMatchesPeriod(
        row as { week_start: string; week_end?: string | null },
        periodStart,
        periodEnd,
        config,
      )
    ) {
      continue;
    }
    const list = byDept.get(deptId) ?? [];
    list.push(row as Record<string, unknown>);
    byDept.set(deptId, list);
  }
  return byDept;
}

function pickPrimaryDepartmentSchedule(
  rows: Record<string, unknown>[],
): Record<string, unknown> | null {
  if (rows.length === 0) return null;
  const published = rows.find(
    (row) =>
      (row as { status?: string }).status === "approved" &&
      !!(row as { published_at?: string | null }).published_at,
  );
  if (published) return published;
  const saved = rows.find((row) =>
    isSavedScheduleAwaitingPublish(row as { status: string; published_at: string | null }),
  );
  if (saved) return saved;
  return [...rows].sort(
    (a, b) =>
      new Date((b as { updated_at?: string }).updated_at ?? 0).getTime() -
      new Date((a as { updated_at?: string }).updated_at ?? 0).getTime(),
  )[0];
}

async function findDepartmentScheduleForPeriod(
  supabase: any,
  departmentId: string,
  periodStart: string,
  periodEnd: string,
  config: BranchPeriodConfig,
): Promise<Record<string, unknown> | null> {
  const rows = await findAllDepartmentSchedulesForPeriod(
    supabase,
    departmentId,
    periodStart,
    periodEnd,
    config,
  );
  return pickPrimaryDepartmentSchedule(rows);
}

function todayIsoCalendar(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString()
    .slice(0, 10);
}

/** Published schedules still active or upcoming (period end >= today). */
async function findActivePublishedSchedulesForDepartment(
  supabase: any,
  departmentId: string,
  config: BranchPeriodConfig,
  todayIso: string,
): Promise<Record<string, unknown>[]> {
  const { data: rows, error } = await supabase
    .from("schedules")
    .select("*")
    .eq("department_id", departmentId)
    .eq("status", "approved")
    .not("published_at", "is", null)
    .order("week_start", { ascending: true });
  if (error) throw error;

  const matches: Record<string, unknown>[] = [];
  for (const row of rows ?? []) {
    const sched = row as {
      week_start: string;
      week_end?: string | null;
      schedule_type?: string | null;
    };
    if (scheduleIsActiveOrUpcoming(sched, config, todayIso)) {
      matches.push(row as Record<string, unknown>);
    }
  }
  return matches;
}

async function getManagedDepartmentIds(
  supabase: any,
  caps: Omit<ScheduleViewerCaps, "userId">,
  userId: string,
): Promise<string[]> {
  if (!caps.isDeptMgr) return [];
  const { data: managedDepts } = await supabase
    .from("departments")
    .select("id")
    .eq("manager_id", userId)
    .eq("is_active", true);
  const ids = new Set<string>((managedDepts ?? []).map((d: any) => d.id as string));
  if (caps.departmentId) ids.add(caps.departmentId);
  return [...ids];
}

async function isScheduleVisibleToCaps(
  schedule: any,
  caps: Omit<ScheduleViewerCaps, "userId">,
  userId: string,
  supabase: any,
) {
  const managedDeptIds = await getManagedDepartmentIds(supabase, caps, userId);
  return canViewScheduleContent(schedule, { ...caps, userId }, managedDeptIds);
}

// ---------- LIST schedules visible to the current user ----------
export const getSchedulesForViewer = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        week_start: z.string(),
        department_id: z.string().uuid().optional(),
        schedule_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start: weekStartKey, end: weekEndKey } = weekStartOf(data.week_start, periodConfig);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.schedule_id) {
      const { data: row, error } = await supabaseAdmin
        .from("schedules")
        .select("*")
        .eq("id", data.schedule_id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (row && (await isScheduleVisibleToCaps(row, caps, context.userId, context.supabase))) {
        return [row];
      }
      return [];
    }

    if (data.department_id) {
      const allRows = await findAllDepartmentSchedulesForPeriod(
        supabaseAdmin,
        data.department_id,
        weekStartKey,
        weekEndKey,
        periodConfig,
      );
      const visibleRows: Record<string, unknown>[] = [];
      for (const row of allRows) {
        if (await isScheduleVisibleToCaps(row, caps, context.userId, context.supabase)) {
          visibleRows.push(row);
        }
      }
      let sched = pickPrimaryDepartmentSchedule(visibleRows);
      if (
        !sched &&
        !caps.isDeptMgr &&
        !isBranchLevelScheduleViewer({ ...caps, userId: context.userId })
      ) {
        const activePublished = await findActivePublishedSchedulesForDepartment(
          supabaseAdmin,
          data.department_id,
          periodConfig,
          todayIsoCalendar(),
        );
        sched = activePublished[0] ?? null;
      }
      return sched ? [sched] : [];
    }

    const seen = new Set<string>();
    const matched: Record<string, unknown>[] = [];
    const consider = (schedule: Record<string, unknown>) => {
      const id = schedule.id as string | undefined;
      if (!id || seen.has(id)) return;
      if (!scheduleMatchesPeriod(schedule as { week_start: string }, weekStartKey, weekEndKey, periodConfig)) {
        return;
      }
      seen.add(id);
      matched.push(schedule);
    };

    const legacyStart = addDaysISO(weekStartKey, -1);
    const { data: periodRows, error: periodErr } = await context.supabase
      .from("schedules")
      .select("*")
      .or(
        [
          `and(week_start.gte.${legacyStart},week_start.lte.${weekEndKey})`,
          `and(week_start.lte.${weekEndKey},week_end.gte.${weekStartKey})`,
        ].join(","),
      );
    if (periodErr) throw new Error(periodErr.message);
    for (const row of periodRows ?? []) consider(row as Record<string, unknown>);

    const visible: any[] = [];
    for (const schedule of matched) {
      if (await isScheduleVisibleToCaps(schedule, caps, context.userId, context.supabase)) {
        visible.push(schedule);
      }
    }
    return visible;
  });

const scheduleShiftsViewerSelect =
  "employee_id, day_date, shift, leave_type_code, published_shift, published_note, published_start_time, published_end_time, submitted_shift, submitted_note, submitted_start_time, submitted_end_time, start_time, end_time, note";

/** Load shift rows for a schedule the viewer may see (admin fetch + visibility gate). */
export const getScheduleShiftsForViewer = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: sched, error: schedErr } = await supabaseAdmin
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (schedErr) throw new Error(schedErr.message);
    if (!sched || !(await isScheduleVisibleToCaps(sched, caps, context.userId, context.supabase))) {
      throw new Error("אין הרשאה לצפות בסידור");
    }
    const { data: shifts, error } = await supabaseAdmin
      .from("schedule_shifts")
      .select(scheduleShiftsViewerSelect)
      .eq("schedule_id", data.schedule_id);
    if (error) throw new Error(error.message);
    return shifts ?? [];
  });

// ---------- CREATE / GET-OR-CREATE schedule ----------
const upsertSchema = z.object({
  department_id: z.string().uuid(),
  week_start: z.string(),
});

export const createOrGetSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canCreate) throw new Error("אין הרשאה ליצור סידור עבודה");
    if (caps.isDeptHeadOnly) {
      if (data.department_id !== caps.departmentId) {
        throw new Error("ניתן ליצור סידור רק עבור המחלקה שלך");
      }
    }
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);
    if (caps.isDeptHeadOnly) {
      const todayHe = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jerusalem",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const currentPeriod = getReferencePeriodStart(todayHe, periodConfig);
      const nextPeriod = shiftPeriodStart(currentPeriod, periodConfig, 1);
      if (start !== currentPeriod && start !== nextPeriod) {
        throw new Error("ניתן ליצור סידור רק לתקופה הנוכחית או לתקופה הבאה");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const periodSchedules = await findAllDepartmentSchedulesForPeriod(
      supabaseAdmin,
      data.department_id,
      start,
      end,
      periodConfig,
    );
    const publishedSched = periodSchedules.find(
      (row) =>
        (row as { status?: string }).status === "approved" &&
        !!(row as { published_at?: string | null }).published_at,
    );
    if (publishedSched) {
      if (await isScheduleVisibleToCaps(publishedSched, caps, context.userId, context.supabase)) {
        return publishedSched;
      }
      throw new Error("כבר קיים סידור מפורסם למחלקה זו בתקופה זו");
    }
    const savedSched = periodSchedules.find((row) =>
      isSavedScheduleAwaitingPublish(row as { status: string; published_at: string | null }),
    );
    if (savedSched) {
      if (await isScheduleVisibleToCaps(savedSched, caps, context.userId, context.supabase)) {
        return savedSched;
      }
      if (
        caps.isDeptHeadOnly &&
        isManagerSavedScheduleForDeptHead(
          savedSched as {
            status: string;
            published_at: string | null;
            submitted_at?: string | null;
            created_by?: string | null;
            submitted_by?: string | null;
            department_id: string;
          },
          context.userId,
        )
      ) {
        throw new Error("כבר קיים סידור עבודה שמור למחלקה זו — ממתין לפרסום");
      }
      if (
        caps.isDeptHeadOnly &&
        isDeptHeadSubmittedAwaitingApproval(
          savedSched as {
            status: string;
            submitted_at?: string | null;
            created_by?: string | null;
            submitted_by?: string | null;
          },
          context.userId,
        )
      ) {
        throw new Error("הסידור נשלח לאישור ההנהלה וממתין לתשובה");
      }
      throw new Error("כבר קיים סידור עבודה שמור למחלקה זו — ממתין לפרסום");
    }
    const existingRow = pickPrimaryDepartmentSchedule(periodSchedules);
    if (existingRow) {
      if (await isScheduleVisibleToCaps(existingRow, caps, context.userId, context.supabase)) {
        return existingRow;
      }
      throw new Error("כבר קיים סידור עבודה לשבוע זה במחלקה זו");
    }
    const departmentEmployees = await getDepartmentScheduleEmployees(
      context.supabase,
      data.department_id,
    );
    if (schedulableDepartmentEmployees(departmentEmployees).length === 0) {
      throw new Error("אין עובדים פעילים במחלקה זו שניתן לשבץ בסידור עבודה");
    }
    const { data: settings } = await context.supabase
      .from("company_settings")
      .select("schedule_type")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const scheduleType = (settings as any)?.schedule_type ?? "weekly";
    const { data: inserted, error } = await context.supabase
      .from("schedules")
      .insert({
        department_id: data.department_id,
        week_start: start,
        week_end: end,
        status: "draft",
        created_by: context.userId,
        schedule_type: scheduleType,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: inserted.id, actor_id: context.userId, action: "created" });
    return inserted;
  });

// ---------- SAVE shifts (bulk) ----------
const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "פורמט שעה לא תקין")
  .nullable()
  .optional();

const scheduleNoteSchema = z
  .string()
  .trim()
  .max(SCHEDULE_NOTE_MAX)
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const saveShiftsSchema = z.object({
  schedule_id: z.string().uuid(),
  shifts: z.array(
    z.object({
      employee_id: z.string().uuid(),
      day_date: z.string(),
      shift: shiftCode,
      start_time: timeStr,
      end_time: timeStr,
      note: scheduleNoteSchema,
      leave_type_code: z.enum(["regular", "sick"]).nullable().optional(),
    }),
  ),
});

export const saveScheduleShifts = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => saveShiftsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched, error: se } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (se || !sched) throw new Error("סידור לא נמצא");
    const caps = await getCaps(context.supabase, context.userId);
    await enforceSupersededPublishedSchedulePolicy(
      context.supabase,
      {
        id: sched.id,
        department_id: sched.department_id,
        week_start: sched.week_start,
        status: sched.status,
        published_at: sched.published_at ?? null,
      },
      caps,
      "edit",
    );
    const isApproved = sched.status === "approved";
    const isPendingApproval = sched.status === "pending_approval";
    if (isApproved && sched.published_at && caps.isDeptHeadOnly) {
      throw new Error("אין הרשאה לערוך סידור מפורסם");
    }
    if (isApproved) {
      if (!caps.isMainAdmin && !caps.canPublishDirect && !caps.canEdit && !caps.canCreate) {
        throw new Error("אין הרשאה לערוך סידור מאושר");
      }
    } else if (isPendingApproval) {
      if (
        !caps.isMainAdmin &&
        !caps.canApprove &&
        !caps.canPublishDirect &&
        !caps.canEdit &&
        !caps.canCreate
      ) {
        throw new Error("אין הרשאה לערוך סידור הממתין לאישור");
      }
    } else if (!["draft", "rejected"].includes(sched.status)) {
      throw new Error("לא ניתן לערוך סידור בסטטוס זה");
    } else if (!caps.canEdit && !(caps.canCreate && sched.created_by === context.userId)) {
      throw new Error("אין הרשאה לעריכת סידור עבודה");
    }

    // Validate shift codes against active shift_definitions
    if (data.shifts.length) {
      const { data: defs } = await context.supabase
        .from("shift_definitions")
        .select("code, is_active");
      const validCodes = new Set((defs ?? []).filter((d: any) => d.is_active).map((d: any) => d.code));
      for (const s of data.shifts) {
        if (!validCodes.has(s.shift)) {
          throw new Error(`קוד משמרת לא תקין או לא פעיל: ${s.shift}`);
        }
      }
    }

    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);

    // Drop shifts for employees marked as not schedulable.
    const deptEmployees = await getDepartmentScheduleEmployees(context.supabase, sched.department_id);
    const schedulableIds = new Set(
      schedulableDepartmentEmployees(deptEmployees).map((e: any) => e.id as string),
    );
    const shiftsInputRaw = normalizeManualOffLeaveTypes(
      deptEmployees,
      applyEmptyOffToShifts(
        sched,
        periodConfig,
        deptEmployees,
        applyLeaveOffToShifts(
          sched,
          periodConfig,
          deptEmployees,
          data.shifts.filter((s) => schedulableIds.has(s.employee_id)),
        ),
      ),
    );

    // Snapshot existing shifts for change detection + preserve published_shift snapshot
    const { data: existingShifts } = await context.supabase
      .from("schedule_shifts")
      .select(
        "employee_id, day_date, shift, published_shift, published_note, published_start_time, published_end_time, submitted_shift, submitted_note, submitted_start_time, submitted_end_time, note, start_time, end_time, branch_id",
      )
      .eq("schedule_id", data.schedule_id);

    const canEditTimesAndNotes = canEditScheduleTimes(caps);
    const timeMap = new Map<string, { start: string | null; end: string | null }>();
    for (const s of existingShifts ?? []) {
      timeMap.set(`${s.employee_id}|${s.day_date}`, {
        start: (s as { start_time?: string | null }).start_time ?? null,
        end: (s as { end_time?: string | null }).end_time ?? null,
      });
    }
    const shiftsInput = canEditTimesAndNotes
      ? shiftsInputRaw
      : shiftsInputRaw.map((s) => {
          const prev = timeMap.get(`${s.employee_id}|${s.day_date}`);
          return {
            ...s,
            start_time: prev?.start ?? null,
            end_time: prev?.end ?? null,
          };
        });

    const beforeSigs = new Set((existingShifts ?? []).map(scheduleCellSaveSignature));
    const afterSigs = new Set(shiftsInput.map(scheduleCellSaveSignature));
    const changed =
      beforeSigs.size !== afterSigs.size ||
      [...beforeSigs].some((k) => !afterSigs.has(k)) ||
      [...afterSigs].some((k) => !beforeSigs.has(k));

    // Preserve submitted/published snapshots across delete+insert.
    type SnapshotCell = {
      published_shift: string | null;
      published_note: string | null;
      published_start_time: string | null;
      published_end_time: string | null;
      submitted_shift: string | null;
      submitted_note: string | null;
      submitted_start_time: string | null;
      submitted_end_time: string | null;
    };
    const snapshotMap = new Map<string, SnapshotCell>();
    const noteMap = new Map<string, string | null>();
    const schedSubmittedAt = (sched as { submitted_at?: string | null }).submitted_at ?? null;
    for (const s of existingShifts ?? []) {
      const key = `${s.employee_id}|${s.day_date}`;
      const row = s as {
        shift: string;
        start_time?: string | null;
        end_time?: string | null;
        note?: string | null;
        submitted_shift?: string | null;
        submitted_note?: string | null;
        submitted_start_time?: string | null;
        submitted_end_time?: string | null;
        published_shift?: string | null;
        published_note?: string | null;
        published_start_time?: string | null;
        published_end_time?: string | null;
      };
      // If submit snapshot columns are missing, seed submitted baseline from the
      // pre-save row so manager edits remain comparable to the dept-head version.
      const submittedShift =
        row.submitted_shift ?? (schedSubmittedAt ? row.shift : null);
      const submittedStart =
        row.submitted_start_time ?? (schedSubmittedAt ? row.start_time ?? null : null);
      const submittedEnd =
        row.submitted_end_time ?? (schedSubmittedAt ? row.end_time ?? null : null);
      const submittedNote =
        row.submitted_note ?? (schedSubmittedAt ? row.note ?? null : null);
      snapshotMap.set(key, {
        published_shift: row.published_shift ?? null,
        published_note: row.published_note ?? null,
        published_start_time: row.published_start_time ?? null,
        published_end_time: row.published_end_time ?? null,
        submitted_shift: submittedShift,
        submitted_note: submittedNote,
        submitted_start_time: submittedStart,
        submitted_end_time: submittedEnd,
      });
      noteMap.set(key, row.note ?? null);
    }
    const canEditNotes = canEditTimesAndNotes;

    // Replace all shifts for the schedule (simpler + atomic-ish)
    const { error: delErr } = await context.supabase
      .from("schedule_shifts")
      .delete()
      .eq("schedule_id", data.schedule_id);
    if (delErr) throw new Error(delErr.message);
    if (shiftsInput.length) {
      const rows = shiftsInput.map((s) => {
        const key = `${s.employee_id}|${s.day_date}`;
        const snap = snapshotMap.get(key);
        const preserveSnapshots = isApproved || isPendingApproval;
        return {
          ...s,
          schedule_id: data.schedule_id,
          note: canEditNotes ? ((s as any).note ?? null) : (noteMap.get(key) ?? null),
          leave_type_code:
            s.shift === "off"
              ? ((s as any).leave_type_code ?? null)
              : null,
          published_shift: preserveSnapshots ? (snap?.published_shift ?? null) : null,
          published_note: preserveSnapshots ? (snap?.published_note ?? null) : null,
          published_start_time: preserveSnapshots ? (snap?.published_start_time ?? null) : null,
          published_end_time: preserveSnapshots ? (snap?.published_end_time ?? null) : null,
          submitted_shift: preserveSnapshots ? (snap?.submitted_shift ?? null) : null,
          submitted_note: preserveSnapshots ? (snap?.submitted_note ?? null) : null,
          submitted_start_time: preserveSnapshots ? (snap?.submitted_start_time ?? null) : null,
          submitted_end_time: preserveSnapshots ? (snap?.submitted_end_time ?? null) : null,
        };
      });
      const { error: insErr } = await context.supabase.from("schedule_shifts").insert(rows);
      if (insErr) {
        if (existingShifts?.length) {
          await context.supabase.from("schedule_shifts").insert(
            existingShifts.map((s: any) => ({
              schedule_id: data.schedule_id,
              employee_id: s.employee_id,
              day_date: s.day_date,
              shift: s.shift,
              published_shift: s.published_shift ?? null,
              published_note: s.published_note ?? null,
              published_start_time: s.published_start_time ?? null,
              published_end_time: s.published_end_time ?? null,
              submitted_shift: s.submitted_shift ?? null,
              submitted_note: s.submitted_note ?? null,
              submitted_start_time: s.submitted_start_time ?? null,
              submitted_end_time: s.submitted_end_time ?? null,
              start_time: s.start_time ?? null,
              end_time: s.end_time ?? null,
              branch_id: s.branch_id ?? null,
              ...(s.note != null ? { note: s.note } : {}),
            })),
          );
        }
        throw new Error(insErr.message);
      }
    }
    if (changed) {
      await context.supabase
        .from("schedules")
        .update({ updated_by: context.userId, updated_at: new Date().toISOString() })
        .eq("id", data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({
          schedule_id: data.schedule_id,
          actor_id: context.userId,
          action: "updated",
        });
    }

    if (isApproved && changed) {
      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי עודכן. נא לעיין בשינויים.",
        context.userId,
      );
    }
    return { ok: true, notified: isApproved && changed };
  });

// ---------- SUBMIT for approval ----------
export const submitSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("סידור לא נמצא");
    if (!["draft", "rejected"].includes(sched.status)) throw new Error("לא ניתן לשלוח שוב");

    // Validate
    const [{ data: shifts }, deptEmployees] = await Promise.all([
      context.supabase
        .from("schedule_shifts")
        .select("employee_id, day_date, shift")
        .eq("schedule_id", data.schedule_id),
      getDepartmentScheduleEmployees(context.supabase, sched.department_id),
    ]);
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const errors: string[] = [];
    const days = weekDaysOfSchedule(sched, periodConfig);

    // Build map employee -> day -> shifts[]
    const map = new Map<string, Map<string, string[]>>();
    for (const s of shifts ?? []) {
      if (!map.has(s.employee_id)) map.set(s.employee_id, new Map());
      const m = map.get(s.employee_id)!;
      if (!m.has(s.day_date)) m.set(s.day_date, []);
      m.get(s.day_date)!.push(s.shift);
    }

    const schedulable = schedulableDepartmentEmployees(deptEmployees ?? []);
    const schedulableIds = new Set(schedulable.map((e: any) => e.id as string));

    applyLeaveOffToShiftMap(sched, periodConfig, deptEmployees ?? [], map);

    // Auto-fill missing (employee, day) cells as "off" so an unset cell defaults
    // to a day off rather than blocking submission.
    const autoFill: { schedule_id: string; employee_id: string; day_date: string; shift: "off" }[] = [];
    for (const emp of schedulable) {
      const m = map.get(emp.id) ?? new Map<string, string[]>();
      for (const d of days) {
        if (!m.has(d)) {
          autoFill.push({ schedule_id: data.schedule_id, employee_id: emp.id, day_date: d, shift: "off" });
          m.set(d, ["off"]);
        }
      }
      if (!map.has(emp.id)) map.set(emp.id, m);
    }
    if (autoFill.length) {
      const { error: afErr } = await context.supabase.from("schedule_shifts").insert(autoFill);
      if (afErr) throw new Error(afErr.message);
    }

    // Duplicates / off-with-shift checks per employee per day
    for (const [empId, dayMap] of map) {
      if (!schedulableIds.has(empId)) continue;
      const emp = schedulable.find((e: any) => e.id === empId);
      const name = emp?.full_name ?? "עובד";
      for (const [day, list] of dayMap) {
        if (list.length > 1) errors.push(`${name}: יותר ממשמרת אחת בתאריך ${day}`);
        if (list.includes("off") && list.some((s) => s !== "off"))
          errors.push(`${name}: חופש ומשמרת באותו יום (${day})`);
      }
    }

    if (errors.length) {
      const err: any = new Error("הסידור לא תקין: " + errors.slice(0, 5).join(" · "));
      err.details = errors;
      throw err;
    }

    const caps = await getCaps(context.supabase, context.userId);
    const nowIso = new Date().toISOString();

    if (caps.canPublishDirect) {
      // Simplified flow: a publisher hitting "publish" on a draft auto-approves
      // AND auto-publishes the schedule in a single step — no separate approve
      // button after save.
      const { error } = await context.supabase
        .from("schedules")
        .update({
          status: "approved",
          submitted_by: context.userId,
          submitted_at: nowIso,
          approved_by: context.userId,
          approved_at: nowIso,
          published_at: nowIso,
          rejection_note: null,
          rejected_at: null,
          rejected_by: null,
        })
        .eq("id", data.schedule_id);
      if (error) throw new Error(error.message);

      await context.supabase
        .from("schedule_audit_log")
        .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "approved" });

      await snapshotPublishedShifts(context.supabase, data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "published" });

      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
        context.userId,
      );

      return { ok: true, approved: true, published: true };
    }

    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "pending_approval",
        submitted_by: context.userId,
        submitted_at: nowIso,
        rejection_note: null,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    // Snapshot current shifts as the submitted baseline so we can detect
    // edits made by the approver before approval/publish.
    await snapshotSubmittedShifts(context.supabase, data.schedule_id);

    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "submitted" });
    return { ok: true, approved: false, published: false };
  });


// ---------- APPROVE ----------
export const approveSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canApprove) throw new Error("אין הרשאה לאשר סידור");
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (sched.created_by === context.userId)
      throw new Error("יוצר הסידור אינו יכול לאשר אותו בעצמו");
    if (sched.status !== "pending_approval") throw new Error("הסידור אינו ממתין לאישור");

    const now = new Date().toISOString();
    // Auto-publish on approval when the approver also has publish permission
    // (main admin / branch manager / explicit publish perm). This restores the
    // pre-update behavior in which approving a schedule made it immediately
    // visible on the dashboard of department employees and the department
    // manager. Approvers without publish permission still need a separate
    // publish step performed by a publisher.
    const autoPublish = !!caps.canPublishDirect;
    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "approved",
        approved_by: context.userId,
        approved_at: now,
        published_at: autoPublish ? now : null,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "approved",
      });

    if (autoPublish) {
      await snapshotPublishedShifts(context.supabase, data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({
          schedule_id: data.schedule_id,
          actor_id: context.userId,
          action: "published",
        });

      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
        context.userId,
      );
    }

    return { ok: true, published: autoPublish };
  });

// ---------- PUBLISH ----------
export const publishSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canPublishDirect) throw new Error("אין הרשאה לפרסם סידור");
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (sched.status !== "approved") throw new Error("ניתן לפרסם רק סידור מאושר");

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "approved",
        published_at: now,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    await snapshotPublishedShifts(context.supabase, data.schedule_id);

    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "published",
      });

    await notifyScheduleDepartment(
      context.supabase,
      data.schedule_id,
      sched.department_id,
      "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
      context.userId,
    );
    return { ok: true };
  });

async function notifySchedulePublished(
  supabase: any,
  scheduleId: string,
  departmentId: string,
  excludeUserId?: string | null,
) {
  await notifyScheduleDepartment(
    supabase,
    scheduleId,
    departmentId,
    "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
    excludeUserId,
  );
}

/** Publish one unpublished schedule using the existing per-status workflow. */
async function publishOneUnpublishedSchedule(
  supabase: any,
  userId: string,
  sched: any,
  caps: Awaited<ReturnType<typeof getCaps>>,
) {
  const nowIso = new Date().toISOString();

  if (sched.status === "approved" && !sched.published_at) {
    const { error } = await supabase
      .from("schedules")
      .update({ status: "approved", published_at: nowIso })
      .eq("id", sched.id);
    if (error) throw new Error(error.message);
    await snapshotPublishedShifts(supabase, sched.id);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
    await notifySchedulePublished(supabase, sched.id, sched.department_id, sched.created_by);
    return;
  }

  if (sched.status === "pending_approval") {
    if (!caps.canApprove) throw new Error("אין הרשאה לאשר סידור");
    if (sched.created_by === userId) throw new Error("יוצר הסידור אינו יכול לאשר אותו בעצמו");
    const { error } = await supabase
      .from("schedules")
      .update({
        status: "approved",
        approved_by: userId,
        approved_at: nowIso,
        published_at: nowIso,
      })
      .eq("id", sched.id);
    if (error) throw new Error(error.message);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "approved" });
    await snapshotPublishedShifts(supabase, sched.id);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
    await notifySchedulePublished(supabase, sched.id, sched.department_id, sched.created_by);
    return;
  }

  if (!["draft", "rejected"].includes(sched.status)) {
    throw new Error("לא ניתן לפרסם סידור בסטטוס זה");
  }

  // Draft / rejected → validate shifts then publish in one step (same as submitSchedule + canPublishDirect).
  const [{ data: shifts }, deptEmployees] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select("employee_id, day_date, shift")
      .eq("schedule_id", sched.id),
    getDepartmentScheduleEmployees(supabase, sched.department_id),
  ]);
  const periodConfig = await fetchBranchPeriodConfig(supabase);
  const errors: string[] = [];
  const days = weekDaysOfSchedule(sched, periodConfig);
  const map = new Map<string, Map<string, string[]>>();
  for (const s of shifts ?? []) {
    if (!map.has(s.employee_id)) map.set(s.employee_id, new Map());
    const m = map.get(s.employee_id)!;
    if (!m.has(s.day_date)) m.set(s.day_date, []);
    m.get(s.day_date)!.push(s.shift);
  }
  const schedulable = schedulableDepartmentEmployees(deptEmployees ?? []);
  const schedulableIds = new Set(schedulable.map((e: any) => e.id as string));

  applyLeaveOffToShiftMap(sched, periodConfig, deptEmployees ?? [], map);

  const autoFill: { schedule_id: string; employee_id: string; day_date: string; shift: "off" }[] = [];
  for (const emp of schedulable) {
    const m = map.get(emp.id) ?? new Map<string, string[]>();
    for (const d of days) {
      if (!m.has(d)) {
        autoFill.push({ schedule_id: sched.id, employee_id: emp.id, day_date: d, shift: "off" });
        m.set(d, ["off"]);
      }
    }
    if (!map.has(emp.id)) map.set(emp.id, m);
  }
  if (autoFill.length) {
    const { error: afErr } = await supabase.from("schedule_shifts").insert(autoFill);
    if (afErr) throw new Error(afErr.message);
  }
  for (const [empId, dayMap] of map) {
    if (!schedulableIds.has(empId)) continue;
    const emp = schedulable.find((e: any) => e.id === empId);
    const name = emp?.full_name ?? "עובד";
    for (const [day, list] of dayMap) {
      if (list.length > 1) errors.push(`${name}: יותר ממשמרת אחת בתאריך ${day}`);
      if (list.includes("off") && list.some((s) => s !== "off"))
        errors.push(`${name}: חופש ומשמרת באותו יום (${day})`);
    }
  }
  if (errors.length) {
    throw new Error(errors.slice(0, 3).join(" · "));
  }

  const { error } = await supabase
    .from("schedules")
    .update({
      status: "approved",
      submitted_by: userId,
      submitted_at: nowIso,
      approved_by: userId,
      approved_at: nowIso,
      published_at: nowIso,
      rejection_note: null,
      rejected_at: null,
      rejected_by: null,
    })
    .eq("id", sched.id);
  if (error) throw new Error(error.message);
  await supabase
    .from("schedule_audit_log")
    .insert({ schedule_id: sched.id, actor_id: userId, action: "approved" });
  await snapshotPublishedShifts(supabase, sched.id);
  await supabase
    .from("schedule_audit_log")
    .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
  await notifySchedulePublished(supabase, sched.id, sched.department_id, userId);
}

// ---------- PUBLISH ALL (week) ----------
export const publishAllWeekSchedules = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ week_start: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canPublishDirect) throw new Error("אין הרשאה לפרסם סידורי עבודה");

    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let deptQ = supabaseAdmin
      .from("departments")
      .select("id, name")
      .eq("is_active", true);
    if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
    const { data: depts, error: dErr } = await deptQ;
    if (dErr) throw new Error(dErr.message);

    const unpublished: any[] = [];
    await Promise.all(
      ((depts ?? []) as { id: string; name: string }[]).map(async (dept) => {
        const periodSchedules = await findAllDepartmentSchedulesForPeriod(
          supabaseAdmin,
          dept.id,
          start,
          end,
          periodConfig,
        );
        for (const row of periodSchedules) {
          const s = row as { status?: string; published_at?: string | null };
          if (!(s.status === "approved" && s.published_at)) {
            unpublished.push(row);
          }
        }
      }),
    );

    if (!unpublished.length) return { ok: true, published: 0, failed: 0, errors: [] as string[] };

    let published = 0;
    const errors: string[] = [];
    for (const sched of unpublished) {
      try {
        await publishOneUnpublishedSchedule(supabaseAdmin, context.userId, sched, caps);
        published++;
      } catch (e: any) {
        const { data: dept } = await supabaseAdmin
          .from("departments")
          .select("name")
          .eq("id", sched.department_id)
          .maybeSingle();
        errors.push(`${dept?.name ?? sched.department_id}: ${e?.message ?? "שגיאה"}`);
      }
    }

    if (published === 0 && errors.length) {
      throw new Error(errors.join("\n"));
    }
    return { ok: true, published, failed: errors.length, errors };
  });

// ---------- REJECT ----------
export const rejectSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ schedule_id: z.string().uuid(), note: z.string().trim().min(1, "נדרשת הערה") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canApprove && !caps.canPublishDirect && !caps.isMainAdmin) {
      throw new Error("אין הרשאה לדחות סידור עבודה");
    }
    const { data: sched, error: selErr } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!sched) throw new Error("סידור לא נמצא");
    if (sched.status !== "pending_approval")
      throw new Error("ניתן לדחות רק סידור הממתין לאישור");
    if (sched.created_by === context.userId)
      throw new Error("יוצר הסידור אינו יכול לדחות בעצמו");

    const nowIso = new Date().toISOString();
    const { error: updErr } = await context.supabase
      .from("schedules")
      .update({
        status: "rejected",
        rejected_by: context.userId,
        rejected_at: nowIso,
        rejection_note: data.note,
        // Clear approval/publish state so the schedule returns cleanly
        // to the department manager for edits and re-submission.
        approved_by: null,
        approved_at: null,
        published_at: null,
      })
      .eq("id", data.schedule_id);
    if (updErr) throw new Error(updErr.message);

    const { error: auditErr } = await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "rejected",
        note: data.note,
      });
    if (auditErr) throw new Error(auditErr.message);

    // Notify the department manager / creator so they know to fix and resubmit.
    const { data: dept } = await context.supabase
      .from("departments")
      .select("manager_id, code")
      .eq("id", sched.department_id)
      .maybeSingle();
    const recipients = new Set<string>();
    if (sched.created_by) recipients.add(sched.created_by);
    if (dept?.manager_id && dept.code !== "management") recipients.add(dept.manager_id);
    if (recipients.size) {
      const recipientList = [...recipients];
      const rejectMsg = `סידור העבודה נדחה: ${data.note}`;
      await context.supabase.from("schedule_notifications").insert(
        recipientList.map((uid) => ({
          schedule_id: data.schedule_id,
          user_id: uid,
          message: rejectMsg,
        })),
      );
      await pushForScheduleNotification({
        userIds: recipientList,
        message: rejectMsg,
        scheduleId: data.schedule_id,
      });
    }
    return { ok: true };
  });

// ---------- Toggle employee schedule exclusion (branch/platform operators only) ----------
export const setEmployeeScheduleExclusion = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        excluded: z.boolean(),
        schedule_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!canEditScheduleTimes(caps)) {
      throw new Error("אין הרשאה");
    }
    if (data.user_id === context.userId) {
      throw new Error("לא ניתן להחריג את עצמך מהסידור");
    }

    const { data: profile, error: pErr } = await context.supabase
      .from("profiles")
      .select("id, department_id, branch_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (pErr || !profile) throw new Error("עובד לא נמצא");
    if (context.branchId && profile.branch_id !== context.branchId) {
      throw new Error("עובד לא נמצא בסניף הפעיל");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ excluded_from_schedule: data.excluded })
      .eq("id", data.user_id);
    if (updErr) throw new Error(updErr.message);

    if (data.excluded && data.schedule_id) {
      await supabaseAdmin
        .from("schedule_shifts")
        .delete()
        .eq("schedule_id", data.schedule_id)
        .eq("employee_id", data.user_id);
    }

    return { ok: true };
  });

// ---------- COPY from previous week ----------
export const copyPreviousWeek = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (!["draft", "rejected"].includes(sched.status))
      throw new Error("ניתן להעתיק רק לטיוטה");
    const prevStart = new Date(sched.week_start + "T00:00:00Z");
    prevStart.setUTCDate(prevStart.getUTCDate() - 7);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const { data: prev } = await context.supabase
      .from("schedules")
      .select("id, week_start")
      .eq("department_id", sched.department_id)
      .eq("week_start", prevStartStr)
      .maybeSingle();
    if (!prev) throw new Error("לא קיים סידור בשבוע הקודם");
    const { data: prevShifts } = await context.supabase
      .from("schedule_shifts")
      .select("employee_id, day_date, shift, note")
      .eq("schedule_id", prev.id);
    const deptEmployees = await getDepartmentScheduleEmployees(context.supabase, sched.department_id);
    const schedulableIds = new Set(
      schedulableDepartmentEmployees(deptEmployees).map((e: any) => e.id as string),
    );
    // Shift dates +7 — skip employees not included in scheduling.
    const next = (prevShifts ?? [])
      .filter((s: any) => schedulableIds.has(s.employee_id))
      .map((s: any) => {
      const d = new Date(s.day_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7);
      return {
        schedule_id: data.schedule_id,
        employee_id: s.employee_id,
        day_date: d.toISOString().slice(0, 10),
        shift: s.shift,
        note: s.note ?? null,
      };
    });
    await context.supabase.from("schedule_shifts").delete().eq("schedule_id", data.schedule_id);
    if (next.length) await context.supabase.from("schedule_shifts").insert(next);
    await context.supabase
      .from("schedules")
      .update({ updated_by: context.userId, updated_at: new Date().toISOString() })
      .eq("id", data.schedule_id);
    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "copied" });
    return { ok: true, count: next.length };
  });

// ---------- DELETE ----------
export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("id, department_id, week_start, status, published_at")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (!sched) throw new Error("סידור לא נמצא");

    await enforceSupersededPublishedSchedulePolicy(
      context.supabase,
      {
        id: sched.id,
        department_id: sched.department_id,
        week_start: sched.week_start,
        status: sched.status,
        published_at: sched.published_at ?? null,
      },
      caps,
      "delete",
    );

    const isOwnDeptMgrDraft =
      caps.isDeptHeadOnly &&
      sched.department_id === caps.departmentId &&
      (sched.status === "draft" || sched.status === "rejected");

    const canManageDelete =
      !caps.isDeptHeadOnly &&
      (caps.isMainAdmin ||
        caps.isBranchManager ||
        caps.canApprove ||
        caps.canPublishDirect ||
        caps.canCreate ||
        caps.canEdit);

    if (!canManageDelete && !isOwnDeptMgrDraft) {
      throw new Error("אין הרשאה למחוק את סידור העבודה");
    }

    // Cascade: shifts, audit, notifications, then schedule
    await context.supabase.from("schedule_shifts").delete().eq("schedule_id", data.schedule_id);
    await context.supabase.from("schedule_notifications").delete().eq("schedule_id", data.schedule_id);
    await context.supabase.from("schedule_audit_log").delete().eq("schedule_id", data.schedule_id);
    const { error } = await context.supabase
      .from("schedules")
      .delete()
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- GET unpublished week summary (combined across all departments) ----------
// Returns aggregated shift counts across ALL schedules for the given week_start
// that are still unpublished (draft / pending_approval / approved-but-not-published).
// Visible only to main_admin, branch managers, or users with schedule manage
// permissions (create/approve/publish). Department managers can see the totals
// across the branch as well so they can plan jointly.
export const getUnpublishedWeekSummary = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ week_start: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const allowed =
      caps.isMainAdmin ||
      caps.isBranchMgr ||
      caps.isDeptMgr ||
      caps.canCreate ||
      caps.canApprove ||
      caps.canPublishDirect;
    if (!allowed) throw new Error("אין הרשאה לצפות בסיכום הסידורים");

    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start } = weekStartOf(data.week_start, periodConfig);

    // All unpublished schedules for the week
    const { data: scheds, error: sErr } = await context.supabase
      .from("schedules")
      .select("id, department_id, status, published_at, submitted_at, created_by")
      .eq("week_start", start);
    if (sErr) throw new Error(sErr.message);
    const viewerCaps = {
      userId: context.userId,
      isMainAdmin: caps.isMainAdmin,
      isBranchMgr: caps.isBranchMgr,
      isDeptMgr: caps.isDeptMgr,
      canView: caps.canView,
      canCreate: caps.canCreate,
      canEdit: caps.canEdit,
      canApprove: caps.canApprove,
      canPublishDirect: caps.canPublishDirect,
      departmentId: caps.departmentId,
    };
    const managedDeptIds = await getManagedDepartmentIds(
      context.supabase,
      viewerCaps,
      context.userId,
    );
    const unpublished = (scheds ?? []).filter(
      (s: any) =>
        (s.status === "draft" ||
          s.status === "pending_approval" ||
          (s.status === "approved" && !s.published_at)) &&
        canViewScheduleContent(s, viewerCaps, managedDeptIds),
    );
    const visibleUnpublished = unpublished;
    if (visibleUnpublished.length === 0) {
      return { week_start: start, totals: {} as Record<string, number>, departments: [] as { id: string; status: string }[], total_assignments: 0 };
    }

    const schedIds = visibleUnpublished.map((s: any) => s.id);
    const { data: shiftRows, error: shErr } = await context.supabase
      .from("schedule_shifts")
      .select("schedule_id, employee_id, day_date, shift")
      .in("schedule_id", schedIds);
    if (shErr) throw new Error(shErr.message);

    // Exclude shifts of employees flagged as not counted in headcount stats.
    const empIds = Array.from(
      new Set((shiftRows ?? []).map((r: any) => r.employee_id).filter(Boolean)),
    );
    let excludedSet = new Set<string>();
    if (empIds.length > 0) {
      const { data: excluded } = await context.supabase
        .from("profiles")
        .select("id")
        .in("id", empIds)
        .or("excluded_from_headcount.eq.true,excluded_from_schedule.eq.true");
      excludedSet = new Set((excluded ?? []).map((p: any) => p.id));
    }

    // Count UNIQUE employees per shift code across the week — an employee
    // working multiple days on the same shift is one person, not many.
    const perShift: Record<string, Set<string>> = {};
    let counted = 0;
    for (const r of shiftRows ?? []) {
      const code = (r as any).shift as string | null;
      const emp = (r as any).employee_id as string | null;
      if (!code || !emp) continue;
      if (excludedSet.has(emp)) continue;
      (perShift[code] ??= new Set<string>()).add(emp);
      counted++;
    }
    const totals: Record<string, number> = {};
    for (const [code, set] of Object.entries(perShift)) totals[code] = set.size;
    return {
      week_start: start,
      totals,
      departments: visibleUnpublished.map((s: any) => ({ id: s.department_id, status: s.status })),
      total_assignments: counted,
    };
  });


/** Branch-wide shift rows for headcount cards — one primary schedule per department. */
export const getBranchPeriodScheduleShifts = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        week_start: z.string(),
        published_only: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (
      !(
        caps.isMainAdmin ||
        caps.isBranchMgr ||
        caps.canView ||
        caps.canCreate ||
        caps.canEdit ||
        caps.canApprove ||
        caps.canPublishDirect
      )
    ) {
      throw new Error("אין הרשאה לצפות בסיכום משמרות");
    }

    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let deptQ = supabaseAdmin
      .from("departments")
      .select("id")
      .eq("is_active", true);
    if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
    const { data: depts, error: dErr } = await deptQ;
    if (dErr) throw new Error(dErr.message);

    const scheduleIds: string[] = [];
    const deptByScheduleId = new Map<string, string>();
    const deptIds = ((depts ?? []) as { id: string }[]).map((d) => d.id);
    const byDept = await findSchedulesForDepartmentsInPeriod(
      supabaseAdmin,
      deptIds,
      start,
      end,
      periodConfig,
    );

    for (const deptId of deptIds) {
      const periodSchedules = byDept.get(deptId) ?? [];
      let primary = null as
        | { id?: string; status?: string; published_at?: string | null }
        | null;
      if (data.published_only) {
        const publishedRows = periodSchedules.filter(
          (row) =>
            (row as { status?: string }).status === "approved" &&
            !!(row as { published_at?: string | null }).published_at,
        );
        primary =
          (pickPrimaryDepartmentSchedule(publishedRows) as typeof primary) ?? null;
      } else {
        primary = pickPrimaryDepartmentSchedule(periodSchedules) as typeof primary;
      }
      const id = primary?.id;
      if (!id) continue;
      if (
        data.published_only &&
        !(
          (primary as { status?: string }).status === "approved" &&
          !!(primary as { published_at?: string | null }).published_at
        )
      ) {
        continue;
      }
      scheduleIds.push(id);
      deptByScheduleId.set(id, deptId);
    }

    if (scheduleIds.length === 0) {
      return {
        shifts: [] as {
          schedule_id: string;
          department_id: string;
          employee_id: string;
          day_date: string;
          shift: string;
          leave_type_code: string | null;
          start_time: string | null;
          end_time: string | null;
        }[],
      };
    }

    const { data: shiftRows, error: shErr } = await supabaseAdmin
      .from("schedule_shifts")
      .select("schedule_id, employee_id, day_date, shift, leave_type_code, start_time, end_time")
      .in("schedule_id", scheduleIds)
      .gte("day_date", start)
      .lte("day_date", end);
    if (shErr) throw new Error(shErr.message);

    const shifts = (shiftRows ?? [])
      .map((row: any) => ({
        schedule_id: row.schedule_id as string,
        department_id: deptByScheduleId.get(row.schedule_id as string) as string,
        employee_id: row.employee_id as string,
        day_date: row.day_date as string,
        shift: row.shift as string,
        leave_type_code: (row.leave_type_code as string | null) ?? null,
        start_time: (row.start_time as string | null) ?? null,
        end_time: (row.end_time as string | null) ?? null,
      }))
      .filter((row) => row.department_id);

    return { shifts };
  });

// ---------- Departments states for a week (RLS-independent enumeration) ----------
// Returns, for the caller's active branch, which active departments have:
//   - no schedule row at all for the exact week_start
//   - a saved draft/pending/approved-but-unpublished schedule
//   - an approved AND published schedule
// Uses the service-role admin client so the counts are consistent for every
// authorized viewer regardless of their per-status RLS visibility.
export const getWeekDepartmentStates = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ week_start: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (
      !(
        caps.isMainAdmin ||
        caps.isBranchMgr ||
        caps.canView ||
        caps.canCreate ||
        caps.canApprove ||
        caps.canPublishDirect
      )
    ) {
      throw new Error("אין הרשאה");
    }
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let deptQ = supabaseAdmin
      .from("departments")
      .select("id, name, is_active, branch_id")
      .eq("is_active", true)
      .order("name");
    if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
    const { data: depts, error: dErr } = await deptQ;
    if (dErr) throw new Error(dErr.message);
    let activeDepts = ((depts ?? []) as any[]).map((d) => ({ id: d.id, name: d.name }));

    if (caps.isDeptHeadOnly) {
      const { data: managedDepts, error: managedErr } = await supabaseAdmin
        .from("departments")
        .select("id, name, is_active")
        .eq("manager_id", context.userId)
        .eq("is_active", true)
        .order("name");
      if (managedErr) throw new Error(managedErr.message);
      activeDepts = ((managedDepts ?? []) as any[]).map((d) => ({ id: d.id, name: d.name }));
      if (activeDepts.length === 0 && caps.departmentId) {
        const fallback = ((depts ?? []) as any[]).find((d) => d.id === caps.departmentId);
        if (fallback) activeDepts = [{ id: fallback.id, name: fallback.name }];
      }
    }

    if (activeDepts.length === 0) {
      return {
        noSchedule: [] as { id: string; name: string }[],
        draft: [] as { id: string; name: string }[],
        published: [] as { id: string; name: string; week_start: string; week_end: string | null }[],
      };
    }

    const byDept = new Map<string, Record<string, unknown>>();
    const periodByDept = await findSchedulesForDepartmentsInPeriod(
      supabaseAdmin,
      activeDepts.map((d) => d.id),
      start,
      end,
      periodConfig,
    );
    for (const d of activeDepts) {
      const primary = pickPrimaryDepartmentSchedule(periodByDept.get(d.id) ?? []);
      if (primary) byDept.set(d.id, primary);
    }

    const noSchedule: { id: string; name: string }[] = [];
    const draft: { id: string; name: string }[] = [];
    const published: { id: string; name: string; week_start: string; week_end: string | null }[] = [];
    for (const d of activeDepts) {
      const s = byDept.get(d.id) as
        | { status?: string; published_at?: string | null; week_start?: string; week_end?: string | null }
        | undefined;
      if (!s) {
        noSchedule.push(d);
        continue;
      }
      if (s.status === "approved" && s.published_at) {
        published.push({
          id: d.id,
          name: d.name,
          week_start: s.week_start ?? start,
          week_end: s.week_end ?? end,
        });
      } else {
        draft.push(d);
      }
    }
    return { noSchedule, draft, published };
  });

/** All unpublished saved schedules for the branch — admin-backed (includes future periods). */
export const getBranchSavedSchedulesAwaitingPublish = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .handler(async ({ context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (
      !(
        caps.isMainAdmin ||
        caps.isBranchMgr ||
        caps.canView ||
        caps.canCreate ||
        caps.canEdit ||
        caps.canApprove ||
        caps.canPublishDirect
      )
    ) {
      throw new Error("אין הרשאה");
    }

    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let deptQ = supabaseAdmin
      .from("departments")
      .select("id")
      .eq("is_active", true);
    if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
    const { data: depts, error: dErr } = await deptQ;
    if (dErr) throw new Error(dErr.message);

    const deptIds = ((depts ?? []) as { id: string }[]).map((d) => d.id);
    if (!deptIds.length) {
      return {
        savedList: [] as {
          schedule_id: string;
          department_id: string;
          week_start: string;
          week_end: string;
          status: string;
          published_at: string | null;
          updated_at: string | null;
        }[],
      };
    }

    const { data: scheds, error } = await supabaseAdmin
      .from("schedules")
      .select(
        "id, department_id, week_start, week_end, status, published_at, updated_at, created_by",
      )
      .in("department_id", deptIds)
      .or(
        "status.eq.draft,status.eq.pending_approval,and(status.eq.approved,published_at.is.null)",
      )
      .order("week_start", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const savedList = ((scheds ?? []) as any[])
      .filter((s) =>
        isSavedScheduleAwaitingPublish({
          status: s.status,
          published_at: s.published_at ?? null,
        }),
      )
      .map((s) => {
        const weekStart = s.week_start as string;
        const weekEnd =
          (s.week_end as string | null) ??
          getPeriodEnd(getPeriodStart(weekStart, periodConfig), periodConfig);
        return {
          schedule_id: s.id as string,
          department_id: s.department_id as string,
          week_start: weekStart,
          week_end: weekEnd,
          status: s.status as string,
          published_at: (s.published_at as string | null) ?? null,
          updated_at: (s.updated_at as string | null) ?? null,
        };
      });

    return { savedList };
  });

/** Returns publish-state flags for one department/week (no shift data). */
export const getDepartmentWeekScheduleFlags = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ department_id: z.string().uuid(), week_start: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);

    let canView =
      caps.isMainAdmin ||
      caps.isBranchMgr ||
      caps.canCreate ||
      caps.canApprove ||
      caps.canPublishDirect ||
      caps.departmentId === data.department_id;

    if (!canView && caps.isDeptMgr) {
      const { data: managed } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", data.department_id)
        .eq("manager_id", context.userId)
        .eq("is_active", true)
        .maybeSingle();
      canView = !!managed;
    }

    if (!canView) throw new Error("אין הרשאה");

    const periodSchedules = await findAllDepartmentSchedulesForPeriod(
      supabaseAdmin,
      data.department_id,
      start,
      end,
      periodConfig,
    );
    // Only a schedule that matches THIS period counts as published here.
    // Never fall back to another week's active/upcoming published row — that
    // leaked current-week publish banners into future weeks.
    const publishedSched = periodSchedules.find(
      (row) =>
        (row as { status?: string }).status === "approved" &&
        !!(row as { published_at?: string | null }).published_at,
    );
    const managerSavedSched = periodSchedules.find((row) =>
      isManagerSavedScheduleForDeptHead(
        row as {
          status: string;
          published_at: string | null;
          submitted_at?: string | null;
          created_by?: string | null;
          submitted_by?: string | null;
          department_id: string;
        },
        context.userId,
      ),
    );
    // Fallback: any unpublished saved row the dept head does not own as an editable draft.
    const blockingSavedForDeptHead =
      managerSavedSched ??
      (caps.isDeptHeadOnly
        ? periodSchedules.find((row) => {
            if (
              !isSavedScheduleAwaitingPublish(
                row as { status: string; published_at: string | null },
              )
            ) {
              return false;
            }
            if (
              isDeptHeadEditableDraft(
                row as {
                  status: string;
                  submitted_at?: string | null;
                  created_by?: string | null;
                  submitted_by?: string | null;
                },
                context.userId,
              )
            ) {
              return false;
            }
            if (
              isDeptHeadSubmittedAwaitingApproval(
                row as {
                  status: string;
                  submitted_at?: string | null;
                  created_by?: string | null;
                  submitted_by?: string | null;
                },
                context.userId,
              )
            ) {
              return false;
            }
            return true;
          })
        : undefined);
    const deptPendingSched = caps.isDeptHeadOnly
      ? periodSchedules.find((row) =>
          isDeptHeadSubmittedAwaitingApproval(
            row as {
              status: string;
              submitted_at?: string | null;
              created_by?: string | null;
              submitted_by?: string | null;
            },
            context.userId,
          ),
        )
      : undefined;
    const savedSched = periodSchedules.find((row) =>
      isSavedScheduleAwaitingPublish(row as { status: string; published_at: string | null }),
    );
    const sched =
      publishedSched ??
      (caps.isDeptHeadOnly ? blockingSavedForDeptHead : savedSched) ??
      savedSched ??
      pickPrimaryDepartmentSchedule(periodSchedules);

    const hasPublished = !!publishedSched;
    const hasSavedAwaitingPublish = periodSchedules.some((row) =>
      isSavedScheduleAwaitingPublish(row as { status: string; published_at: string | null }),
    );
    const hasManagerSavedAwaitingPublish = !!blockingSavedForDeptHead;
    const hasDeptHeadPendingApproval = !!deptPendingSched;
    const blockingMeta = blockingSavedForDeptHead ?? savedSched;

    return {
      hasPublished,
      hasSavedAwaitingPublish,
      hasManagerSavedAwaitingPublish,
      hasDeptHeadPendingApproval,
      publishedScheduleId: (publishedSched as { id?: string } | null)?.id ?? null,
      published_week_start:
        (publishedSched as { week_start?: string } | null)?.week_start ?? null,
      schedule_id: (sched as { id?: string } | null)?.id ?? null,
      schedule_week_start: (sched as { week_start?: string } | null)?.week_start ?? null,
      awaitingPublish:
        (hasManagerSavedAwaitingPublish ||
          (!caps.isDeptHeadOnly && hasSavedAwaitingPublish)) &&
        blockingMeta
          ? {
              status: (blockingMeta as { status: string }).status,
              created_by:
                ((blockingMeta as { created_by?: string | null }).created_by) ?? null,
              saved_at:
                ((blockingMeta as { updated_at?: string | null }).updated_at) ??
                ((blockingMeta as { created_at?: string | null }).created_at) ??
                null,
            }
          : null,
      pendingApproval: hasDeptHeadPendingApproval && deptPendingSched
        ? {
            submitted_at:
              ((deptPendingSched as { submitted_at?: string | null }).submitted_at) ?? null,
          }
        : null,
    };
  });

async function enrichOverviewEmployeesFromShifts(
  supabaseAdmin: any,
  departments: { id: string; scheduleId: string | null }[],
  employeesByDept: Record<string, any[]>,
  shifts: { schedule_id: string; employee_id: string }[],
) {
  const result: Record<string, any[]> = {};
  for (const dept of departments) {
    result[dept.id] = [...(employeesByDept[dept.id] ?? [])];
  }

  const missingIds = new Set<string>();
  for (const dept of departments) {
    if (!dept.scheduleId) continue;
    const known = new Set((result[dept.id] ?? []).map((e: any) => e.id as string));
    for (const row of shifts.filter((s) => s.schedule_id === dept.scheduleId)) {
      if (!known.has(row.employee_id)) missingIds.add(row.employee_id);
    }
  }
  if (!missingIds.size) return result;

  const { data: profiles, error } = await supabaseAdmin
    .from("profiles")
    .select(
      "id, full_name, excluded_from_schedule, excluded_from_headcount, on_leave, leave_start_date, leave_end_date, leave_type_code",
    )
    .in("id", [...missingIds])
    .eq("is_active", true);
  if (error) throw new Error(error.message);

  for (const dept of departments) {
    if (!dept.scheduleId) continue;
    const known = new Set((result[dept.id] ?? []).map((e: any) => e.id as string));
    const shiftIds = new Set(
      shifts.filter((s) => s.schedule_id === dept.scheduleId).map((s) => s.employee_id),
    );
    for (const row of profiles ?? []) {
      if (known.has(row.id)) continue;
      if (shiftIds.has(row.id)) {
        result[dept.id] = [...(result[dept.id] ?? []), row];
        known.add(row.id);
      }
    }
    result[dept.id]?.sort((a: any, b: any) =>
      String(a.full_name).localeCompare(String(b.full_name), "he"),
    );
  }
  return result;
}

type DashboardPublishedPeriodRow = {
  weekStart: string;
  periodStart: string;
  periodEnd: string;
  publishedAt: string | null;
};

function publishedPeriodsOverlap(
  a: Pick<DashboardPublishedPeriodRow, "periodStart" | "periodEnd">,
  b: Pick<DashboardPublishedPeriodRow, "periodStart" | "periodEnd">,
): boolean {
  return a.periodStart <= b.periodEnd && b.periodStart <= a.periodEnd;
}

/** When calendar ranges overlap, keep only the newest published period for dashboard cards. */
function dedupeOverlappingPublishedPeriods(
  periods: DashboardPublishedPeriodRow[],
): DashboardPublishedPeriodRow[] {
  const sorted = [...periods].sort((a, b) => {
    const pubA = a.publishedAt ?? "";
    const pubB = b.publishedAt ?? "";
    if (pubA !== pubB) return pubB.localeCompare(pubA);
    return b.weekStart.localeCompare(a.weekStart);
  });
  const kept: DashboardPublishedPeriodRow[] = [];
  for (const period of sorted) {
    if (!kept.some((existing) => publishedPeriodsOverlap(existing, period))) {
      kept.push(period);
    }
  }
  return kept.sort((a, b) => a.periodStart.localeCompare(b.periodStart));
}

/** Active published schedule periods for dashboard cards — same visibility as daily overview. */
export const getDashboardPublishedPeriods = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        scope: z.enum(["branch", "department"]),
        department_id: z.string().uuid().optional(),
        use_coworkers_view: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const capsRaw = await getCaps(context.supabase, context.userId);
    const caps: ScheduleViewerCaps = {
      userId: context.userId,
      isMainAdmin: capsRaw.isMainAdmin,
      isBranchMgr: capsRaw.isBranchMgr,
      isDeptMgr: capsRaw.isDeptMgr,
      canView: capsRaw.canView,
      canCreate: capsRaw.canCreate,
      canEdit: capsRaw.canEdit,
      canApprove: capsRaw.canApprove,
      canPublishDirect: capsRaw.canPublishDirect,
      departmentId: capsRaw.departmentId,
    };
    const managedDeptIds = await getManagedDepartmentIds(
      context.supabase,
      capsRaw,
      context.userId,
    );
    const useCoworkersView = !!data.use_coworkers_view;
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const todayIso = todayIsoCalendar();
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const branchLevelViewer = isBranchLevelScheduleViewer(caps);

    let departments: { id: string }[] = [];
    if (data.scope === "department") {
      const targetDeptId = data.department_id ?? caps.departmentId;
      if (!targetDeptId) return { periods: [] as DashboardPublishedPeriodRow[] };

      let allowed =
        branchLevelViewer ||
        (useCoworkersView && caps.departmentId === targetDeptId) ||
        managedDeptIds.includes(targetDeptId);
      if (!allowed) {
        allowed = await isScheduleVisibleToCaps(
          {
            department_id: targetDeptId,
            status: "approved",
            published_at: new Date().toISOString(),
          },
          caps,
          context.userId,
          context.supabase,
        ).catch(() => false);
      }
      if (!allowed) throw new Error("אין הרשאה");

      const { data: dept, error } = await supabaseAdmin
        .from("departments")
        .select("id")
        .eq("id", targetDeptId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      departments = dept ? [{ id: dept.id }] : [];
    } else {
      if (!branchLevelViewer) throw new Error("אין הרשאה");
      let deptQ = supabaseAdmin
        .from("departments")
        .select("id")
        .eq("is_active", true)
        .order("name");
      if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
      const { data: depts, error } = await deptQ;
      if (error) throw new Error(error.message);
      departments = (depts ?? []) as { id: string }[];
    }

    const periodByAnchor = new Map<string, DashboardPublishedPeriodRow>();
    const deptIds = departments.map((d) => d.id);
    if (!deptIds.length) return { periods: [] as DashboardPublishedPeriodRow[] };

    const { data: publishedRows, error: pubErr } = await supabaseAdmin
      .from("schedules")
      .select("*")
      .in("department_id", deptIds)
      .eq("status", "approved")
      .not("published_at", "is", null)
      .order("week_start", { ascending: true });
    if (pubErr) throw new Error(pubErr.message);

    for (const row of publishedRows ?? []) {
      const sched = row as {
        week_start: string;
        week_end?: string | null;
        schedule_type?: string | null;
        published_at: string | null;
      };
      if (!scheduleIsActiveOrUpcoming(sched, periodConfig, todayIso)) continue;
      if (!branchLevelViewer) {
        const visible = await isScheduleVisibleToCaps(
          row,
          caps,
          context.userId,
          context.supabase,
        );
        if (!visible) continue;
      }

      const { start: normStart } = weekStartOf(sched.week_start, periodConfig);
      const days = weekDaysOfSchedule(sched, periodConfig);
      if (!days.length) continue;

      const periodStart = days[0]!;
      const periodEnd = days[days.length - 1]!;
      const publishedAt = sched.published_at;
      const existing = periodByAnchor.get(normStart);
      if (!existing) {
        periodByAnchor.set(normStart, {
          weekStart: normStart,
          periodStart,
          periodEnd,
          publishedAt,
        });
        continue;
      }
      if ((publishedAt ?? "") > (existing.publishedAt ?? "")) {
        existing.publishedAt = publishedAt;
      }
      if (periodStart < existing.periodStart) existing.periodStart = periodStart;
      if (periodEnd > existing.periodEnd) existing.periodEnd = periodEnd;
    }

    const periods = dedupeOverlappingPublishedPeriods([...periodByAnchor.values()]);
    return { periods };
  });

/** Dashboard daily overview — same visibility rules as the schedule editor, admin-backed reads. */
export const getDailyScheduleOverview = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        week_start: z.string(),
        scope: z.enum(["branch", "department"]),
        department_id: z.string().uuid().optional(),
        use_coworkers_view: z.boolean().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const capsRaw = await getCaps(context.supabase, context.userId);
    const caps: ScheduleViewerCaps = {
      userId: context.userId,
      isMainAdmin: capsRaw.isMainAdmin,
      isBranchMgr: capsRaw.isBranchMgr,
      isDeptMgr: capsRaw.isDeptMgr,
      canView: capsRaw.canView,
      canCreate: capsRaw.canCreate,
      canEdit: capsRaw.canEdit,
      canApprove: capsRaw.canApprove,
      canPublishDirect: capsRaw.canPublishDirect,
      departmentId: capsRaw.departmentId,
    };
    const managedDeptIds = await getManagedDepartmentIds(
      context.supabase,
      capsRaw,
      context.userId,
    );
    const useCoworkersView = !!data.use_coworkers_view;
    const periodConfig = await fetchBranchPeriodConfig(context.supabase, context.branchId);
    const { start, end } = weekStartOf(data.week_start, periodConfig);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let departments: { id: string; name: string }[] = [];
    if (data.scope === "department") {
      const targetDeptId = data.department_id ?? caps.departmentId;
      if (!targetDeptId) {
        return { departments: [], employeesByDept: {}, shifts: [] };
      }
      let allowed =
        isBranchLevelScheduleViewer(caps) ||
        (useCoworkersView && caps.departmentId === targetDeptId) ||
        managedDeptIds.includes(targetDeptId);
      if (!allowed) {
        allowed = await isScheduleVisibleToCaps(
          {
            department_id: targetDeptId,
            status: "approved",
            published_at: new Date().toISOString(),
          },
          caps,
          context.userId,
          context.supabase,
        ).catch(() => false);
      }
      if (!allowed) throw new Error("אין הרשאה");

      const { data: dept, error } = await supabaseAdmin
        .from("departments")
        .select("id, name")
        .eq("id", targetDeptId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      departments = dept ? [{ id: dept.id, name: dept.name }] : [];
    } else {
      if (!isBranchLevelScheduleViewer(caps)) {
        throw new Error("אין הרשאה");
      }
      let deptQ = supabaseAdmin
        .from("departments")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
      const { data: depts, error } = await deptQ;
      if (error) throw new Error(error.message);
      departments = (depts ?? []) as { id: string; name: string }[];
    }

    if (!departments.length) {
      return { departments: [], employeesByDept: {}, shifts: [] };
    }

    const candidatesByDept = await findSchedulesForDepartmentsInPeriod(
      supabaseAdmin,
      departments.map((d) => d.id),
      start,
      end,
      periodConfig,
    );

    const todayIso = todayIsoCalendar();
    // Canonical days for the requested period only — never merge other weeks.
    const periodDisplayDays = buildPeriodDays(start, periodConfig);

    const departmentMeta: {
      id: string;
      overviewKey: string;
      name: string;
      hasPublishedSchedule: boolean;
      scheduleId: string | null;
      scheduleWeekStart: string | null;
      scheduleWeekEnd: string | null;
      hasSavedAwaitingPublish: boolean;
      changeBaselineKind: ReturnType<typeof resolveScheduleChangeBaselineKind>;
    }[] = [];
    const scheduleIdSet = new Set<string>();
    const branchLevelViewer = isBranchLevelScheduleViewer(caps);

    for (const dept of departments) {
      const periodCandidates = candidatesByDept.get(dept.id) ?? [];
      const publishedInPeriod = periodCandidates.filter(
        (row) =>
          (row as { status?: string }).status === "approved" &&
          !!(row as { published_at?: string | null }).published_at,
      );
      const hasUnpublishedSaved = periodCandidates.some((s) =>
        isSavedScheduleAwaitingPublish(s as { status: string; published_at: string | null }),
      );

      if (publishedInPeriod.length > 0) {
        for (const sched of publishedInPeriod) {
          const row = sched as {
            id: string;
            week_start: string;
            week_end?: string | null;
            schedule_type?: string | null;
            status: string;
            published_at: string | null;
            submitted_at?: string | null;
          };
          scheduleIdSet.add(row.id);
          departmentMeta.push({
            id: dept.id,
            overviewKey: `${dept.id}:${row.id}`,
            name: dept.name,
            hasPublishedSchedule: true,
            scheduleId: row.id,
            scheduleWeekStart: periodDisplayDays[0] ?? start,
            scheduleWeekEnd:
              periodDisplayDays[periodDisplayDays.length - 1] ?? end,
            hasSavedAwaitingPublish: false,
            changeBaselineKind: resolveScheduleChangeBaselineKind({
              status: row.status,
              published_at: row.published_at,
              submitted_at: row.submitted_at,
            }),
          });
        }
        continue;
      }

      let sched: any = null;
      if (!useCoworkersView && periodCandidates.length) {
        const activeCandidate = (s: any) =>
          s.status === "approved" &&
          s.published_at &&
          scheduleIsActiveOrUpcoming(
            s as { week_start: string; week_end?: string | null; schedule_type?: string | null },
            periodConfig,
            todayIso,
          );

        if (branchLevelViewer) {
          sched =
            periodCandidates.find(activeCandidate) ??
            periodCandidates.find((s) => s.status === "approved" && s.published_at) ??
            periodCandidates[0];
        } else if (caps.isDeptMgr && managedDeptIds.includes(dept.id)) {
          const visible: any[] = [];
          for (const s of periodCandidates) {
            if (
              await isScheduleVisibleToCaps(
                s,
                caps,
                context.userId,
                context.supabase,
              )
            ) {
              visible.push(s);
            }
          }
          sched =
            visible.find((s) => s.status === "approved" && s.published_at) ??
            visible[0] ??
            periodCandidates.find((s) => s.status === "approved" && s.published_at) ??
            periodCandidates[0];
        } else {
          const visible: any[] = [];
          for (const s of periodCandidates) {
            if (
              await isScheduleVisibleToCaps(
                s,
                caps,
                context.userId,
                context.supabase,
              )
            ) {
              visible.push(s);
            }
          }
          if (visible.length) {
            sched =
              visible.find((s) => s.status === "approved" && s.published_at) ??
              visible[0];
          }
        }
      }

      if (sched?.id) {
        scheduleIdSet.add(sched.id as string);
      }

      departmentMeta.push({
        id: dept.id,
        overviewKey: `${dept.id}:${sched?.id ?? "none"}`,
        name: dept.name,
        hasPublishedSchedule: !!(sched?.status === "approved" && sched?.published_at),
        scheduleId: (sched as { id?: string } | null)?.id ?? null,
        scheduleWeekStart: periodDisplayDays[0] ?? start,
        scheduleWeekEnd: periodDisplayDays[periodDisplayDays.length - 1] ?? end,
        hasSavedAwaitingPublish: useCoworkersView
          ? hasUnpublishedSaved
          : hasUnpublishedSaved || isSavedScheduleAwaitingPublish(sched),
        changeBaselineKind: sched
          ? resolveScheduleChangeBaselineKind({
              status: sched.status,
              published_at: sched.published_at,
              submitted_at: sched.submitted_at,
            })
          : null,
      });
    }

    const scheduleIds = [...scheduleIdSet];
    let shifts: any[] = [];
    if (scheduleIds.length) {
      const { data: shiftRows, error: shiftErr } = await supabaseAdmin
        .from("schedule_shifts")
        .select(
          "employee_id, day_date, shift, leave_type_code, published_shift, published_note, published_start_time, published_end_time, submitted_shift, submitted_note, submitted_start_time, submitted_end_time, start_time, end_time, note, schedule_id",
        )
        .in("schedule_id", scheduleIds)
        .gte("day_date", start)
        .lte("day_date", end);
      if (shiftErr) throw new Error(shiftErr.message);
      shifts = shiftRows ?? [];
    }

    const employeesByDept: Record<string, any[]> = {};
    const uniqueDeptIds = [...new Set(departmentMeta.map((d) => d.id))];
    await Promise.all(
      uniqueDeptIds.map(async (deptId) => {
        employeesByDept[deptId] = await getDepartmentScheduleEmployees(
          supabaseAdmin,
          deptId,
        );
      }),
    );

    const enrichedEmployees = await enrichOverviewEmployeesFromShifts(
      supabaseAdmin,
      departmentMeta.map((d) => ({ id: d.id, scheduleId: d.scheduleId })),
      employeesByDept,
      shifts,
    );

    return {
      departments: departmentMeta,
      employeesByDept: enrichedEmployees,
      shifts,
      weekStart: start,
      weekEnd: end,
      weekDays: periodDisplayDays,
    };
  });

type ColleagueRow = {
  id: string;
  full_name: string | null;
  job_title: string | null;
  phone: string | null;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  isDepartmentHead: boolean;
};

/** Department colleagues for employee dashboard — admin-backed, includes dept head + phone. */
export const getDepartmentColleaguesForViewer = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .handler(async ({ context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const deptId = caps.departmentId;
    if (!deptId) {
      return { colleagues: [] as ColleagueRow[], departmentName: null as string | null, managerId: null as string | null };
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: dept, error: deptErr } = await supabaseAdmin
      .from("departments")
      .select("name, manager_id, code")
      .eq("id", deptId)
      .eq("is_active", true)
      .maybeSingle();
    if (deptErr) throw new Error(deptErr.message);

    const managerId = (dept?.manager_id as string | null | undefined) ?? null;
    const rows = await getDepartmentScheduleEmployees(supabaseAdmin, deptId);
    const ids = rows
      .map((r: { id: string }) => r.id)
      .filter((id) => id !== context.userId);
    if (!ids.length) {
      return {
        colleagues: [] as ColleagueRow[],
        departmentName: (dept?.name as string | null) ?? null,
        managerId,
      };
    }

    const { data: profiles, error } = await supabaseAdmin
      .from("profiles")
      .select(
        "id, full_name, job_title, phone, on_leave, leave_start_date, leave_end_date, is_active",
      )
      .in("id", ids)
      .eq("is_active", true)
      .order("full_name");
    if (error) throw new Error(error.message);

    const colleagues: ColleagueRow[] = (profiles ?? [])
      .map((p) => ({
        id: p.id as string,
        full_name: (p.full_name as string | null) ?? null,
        job_title: (p.job_title as string | null) ?? null,
        phone: (p.phone as string | null) ?? null,
        on_leave: !!p.on_leave,
        leave_start_date: (p.leave_start_date as string | null) ?? null,
        leave_end_date: (p.leave_end_date as string | null) ?? null,
        isDepartmentHead: managerId != null && p.id === managerId,
      }))
      .sort((a, b) => {
        if (a.isDepartmentHead && !b.isDepartmentHead) return -1;
        if (!a.isDepartmentHead && b.isDepartmentHead) return 1;
        return (a.full_name ?? "").localeCompare(b.full_name ?? "", "he");
      });

    return {
      colleagues,
      departmentName: (dept?.name as string | null) ?? null,
      managerId,
    };
  });
