import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiAssistantKind } from "@/modules/ai";
import { getScheduleWeek } from "@/lib/schedule-week";
import { todayJerusalemDate } from "@/lib/break-workflow";
import { isEmployeeCurrentlyOnLeave } from "@/lib/employee-leave";
import { formatEmployeeName } from "@/lib/employee-name";

type Db = SupabaseClient<Database>;

type CoworkerRow = {
  id: string;
  full_name: string | null;
  is_active: boolean;
  on_leave: boolean;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  job_title: string | null;
  excluded_from_headcount?: boolean | null;
};

type TaskRow = {
  id: string;
  title: string;
  status: string;
  due_at: string | null;
  created_at: string | null;
  assignee_id: string | null;
  department_id: string | null;
};

function jerusalemTodayIso(): string {
  return todayJerusalemDate();
}

function leaveAvailable(row: {
  manual_balance?: number | null;
  accrued_days?: number | null;
  used_days?: number | null;
  reserved_days?: number | null;
}): number {
  return (
    (row.manual_balance ?? 0) +
    (row.accrued_days ?? 0) -
    (row.used_days ?? 0) -
    (row.reserved_days ?? 0)
  );
}

function isCountedInHeadcount(row: Pick<CoworkerRow, "excluded_from_headcount">): boolean {
  return !row.excluded_from_headcount;
}

function memberStatus(row: CoworkerRow, today: string): "active" | "on_leave" | "inactive" {
  if (!row.is_active) return "inactive";
  if (isEmployeeCurrentlyOnLeave(row, today)) return "on_leave";
  return "active";
}

async function userHasRole(supabase: Db, userId: string, role: string): Promise<boolean> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).some((r) => r.role === role);
}

export async function buildEmployeeSnapshot(supabase: Db, userId: string) {
  const today = jerusalemTodayIso();
  const { weekStart, weekDays } = getScheduleWeek(new Date(`${today}T12:00:00Z`));

  const [profileRes, balancesRes, requestsRes, breaksRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, first_name, last_name, job_title, department_id, on_leave, leave_start_date, leave_end_date, departments(name)",
      )
      .eq("id", userId)
      .maybeSingle(),
    (supabase as any)
      .from("leave_balances")
      .select("manual_balance, accrued_days, used_days, reserved_days, leave_types(name, code)")
      .eq("user_id", userId),
    (supabase as any)
      .from("leave_requests")
      .select("status, start_date, end_date, submitted_at, leave_types(name, code)")
      .eq("user_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(5),
    supabase
      .from("break_requests")
      .select("status, duration_minutes, requested_at, started_at, ends_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const profile = profileRes.data as {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    job_title?: string | null;
    department_id?: string | null;
    on_leave?: boolean | null;
    leave_start_date?: string | null;
    leave_end_date?: string | null;
    departments?: { name?: string | null } | null;
  } | null;

  const displayName = formatEmployeeName({
    full_name: profile?.full_name,
    first_name: profile?.first_name,
    last_name: profile?.last_name,
  });

  const balances = ((balancesRes.data ?? []) as Array<{
    manual_balance?: number | null;
    accrued_days?: number | null;
    used_days?: number | null;
    reserved_days?: number | null;
    leave_types?: { name?: string | null; code?: string | null } | null;
  }>).map((row) => ({
    type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
    availableDays: Math.round(leaveAvailable(row) * 100) / 100,
  }));

  const recentLeaveRequests = ((requestsRes.data ?? []) as Array<{
    status?: string;
    start_date?: string;
    end_date?: string;
    leave_types?: { name?: string | null; code?: string | null } | null;
  }>).map((row) => ({
    type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
    status: row.status ?? "unknown",
    from: row.start_date ?? "",
    to: row.end_date ?? "",
  }));

  const breakRows = (breaksRes.data ?? []) as Array<{
    status?: string;
    duration_minutes?: number;
    requested_at?: string;
    started_at?: string | null;
    ends_at?: string | null;
    created_at?: string;
  }>;

  const breaksToday = breakRows.filter((row) => {
    const stamp = row.started_at ?? row.requested_at ?? row.created_at ?? "";
    return stamp.slice(0, 10) === today;
  });

  let weekSchedule: Array<{ date: string; shift: string; leaveCode?: string | null }> = [];

  if (profile?.department_id) {
    const { data: scheds } = await supabase
      .from("schedules")
      .select("id")
      .eq("department_id", profile.department_id)
      .eq("week_start", weekStart)
      .eq("status", "approved")
      .not("published_at", "is", null);

    const scheduleIds = (scheds ?? []).map((s) => s.id);
    if (scheduleIds.length > 0) {
      const { data: shiftRows } = await (supabase as any)
        .from("schedule_shifts")
        .select("day_date, shift, leave_type_code")
        .eq("employee_id", userId)
        .in("schedule_id", scheduleIds)
        .in("day_date", weekDays);

      weekSchedule = ((shiftRows ?? []) as Array<{
        day_date: string;
        shift: string;
        leave_type_code?: string | null;
      }>)
        .map((row) => ({
          date: row.day_date,
          shift: row.shift,
          leaveCode: row.leave_type_code ?? null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  return {
    asOfDate: today,
    profile: {
      name: displayName,
      jobTitle: profile?.job_title ?? null,
      department: profile?.departments?.name ?? null,
      onLeaveNow: !!profile?.on_leave,
      leaveUntil: profile?.on_leave ? profile.leave_end_date : null,
    },
    leaveBalances: balances,
    recentLeaveRequests,
    breaksToday: breaksToday.map((row) => ({
      status: row.status ?? "unknown",
      durationMinutes: row.duration_minutes ?? null,
    })),
    scheduleThisWeek: weekSchedule.length
      ? { weekStart, days: weekSchedule }
      : { weekStart, days: [], note: "No published schedule shifts found for this week." },
  };
}

async function loadDepartmentTasks(supabase: Db, userId: string, departmentId: string, limit = 3) {
  const { data: profile } = await supabase
    .from("profiles")
    .select("branch_id")
    .eq("id", userId)
    .maybeSingle();
  const branchId = (profile?.branch_id as string | null | undefined) ?? null;

  let rows: TaskRow[] = [];
  if (branchId) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, status, due_at, created_at, assignee_id, department_id")
      .eq("branch_id", branchId)
      .eq("department_id", departmentId)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = (data ?? []) as TaskRow[];
  }

  if (!rows.length) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, title, status, due_at, created_at, assignee_id, department_id")
      .eq("department_id", departmentId)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) throw error;
    rows = (data ?? []) as TaskRow[];
  }

  const taskIds = rows.map((r) => r.id);
  const assigneeMap = new Map<string, string[]>();
  if (taskIds.length) {
    const { data: assigneeRows } = await supabase
      .from("task_assignees")
      .select("task_id, user_id")
      .in("task_id", taskIds);
    for (const row of assigneeRows ?? []) {
      const list = assigneeMap.get(row.task_id) ?? [];
      list.push(row.user_id);
      assigneeMap.set(row.task_id, list);
    }
  }

  const assigneeIds = new Set<string>();
  for (const task of rows) {
    if (task.assignee_id) assigneeIds.add(task.assignee_id);
    for (const uid of assigneeMap.get(task.id) ?? []) assigneeIds.add(uid);
  }

  const nameById = new Map<string, string>();
  if (assigneeIds.size) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name")
      .in("id", Array.from(assigneeIds));
    for (const p of profiles ?? []) {
      nameById.set(
        p.id,
        formatEmployeeName({
          full_name: p.full_name,
          first_name: p.first_name,
          last_name: p.last_name,
        }),
      );
    }
  }

  const doneStatuses = new Set(["completed", "closed"]);

  return rows.map((task) => {
    const ids = new Set<string>();
    if (task.assignee_id) ids.add(task.assignee_id);
    for (const uid of assigneeMap.get(task.id) ?? []) ids.add(uid);
    const assigneeNames = Array.from(ids).map((id) => nameById.get(id) ?? "—");
    const taskDone = doneStatuses.has(task.status);
    return {
      title: task.title,
      status: task.status,
      dueAt: task.due_at,
      createdAt: task.created_at,
      assignees: assigneeNames,
      notCompletedAssignees: taskDone ? [] : assigneeNames,
    };
  });
}

async function buildDepartmentScheduleSummary(
  supabase: Db,
  departmentId: string,
  weekStart: string,
  weekDays: string[],
) {
  const { data: scheds } = await supabase
    .from("schedules")
    .select("id")
    .eq("department_id", departmentId)
    .eq("week_start", weekStart)
    .eq("status", "approved")
    .not("published_at", "is", null);

  const scheduleIds = (scheds ?? []).map((s) => s.id);
  if (!scheduleIds.length) {
    return { weekStart, days: [], note: "No published department schedule for this week." };
  }

  const { data: shiftRows } = await (supabase as any)
    .from("schedule_shifts")
    .select("day_date, shift, leave_type_code")
    .in("schedule_id", scheduleIds)
    .in("day_date", weekDays);

  const byDay = new Map<string, { morning: number; evening: number; off: number; onLeave: number }>();
  for (const day of weekDays) {
    byDay.set(day, { morning: 0, evening: 0, off: 0, onLeave: 0 });
  }

  for (const row of (shiftRows ?? []) as Array<{
    day_date: string;
    shift: string;
    leave_type_code?: string | null;
  }>) {
    const bucket = byDay.get(row.day_date);
    if (!bucket) continue;
    if (row.leave_type_code) {
      bucket.onLeave += 1;
      continue;
    }
    if (row.shift === "morning") bucket.morning += 1;
    else if (row.shift === "evening") bucket.evening += 1;
    else bucket.off += 1;
  }

  return {
    weekStart,
    days: weekDays.map((date) => ({ date, ...byDay.get(date)! })),
  };
}

async function buildDeptHeadSnapshot(supabase: Db, userId: string) {
  const today = jerusalemTodayIso();
  const { weekStart, weekDays } = getScheduleWeek(new Date(`${today}T12:00:00Z`));

  const [managerProfileRes, coworkersRes, pendingLeavesRes, activeBreaksRes, dailyBreaksRes, personal] =
    await Promise.all([
      supabase
        .from("profiles")
        .select(
          "full_name, first_name, last_name, job_title, department_id, departments(name)",
        )
        .eq("id", userId)
        .maybeSingle(),
      (supabase as any).rpc("get_department_coworkers"),
      (supabase as any)
        .from("leave_requests")
        .select(
          "status, start_date, end_date, submitted_at, leave_types(name, code), profiles!user_id(full_name, first_name, last_name)",
        )
        .eq("status", "pending_dept")
        .order("submitted_at", { ascending: false })
        .limit(10),
      (supabase as any).rpc("list_managed_department_active_breaks"),
      (supabase as any).rpc("list_managed_department_daily_breaks"),
      buildEmployeeSnapshot(supabase, userId),
    ]);

  const managerProfile = managerProfileRes.data as {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    job_title?: string | null;
    department_id?: string | null;
    departments?: { name?: string | null } | null;
  } | null;

  const departmentId = managerProfile?.department_id ?? null;
  const departmentName = managerProfile?.departments?.name ?? null;

  const coworkers = ((coworkersRes.data ?? []) as CoworkerRow[]).filter(isCountedInHeadcount);
  const teamMembers = coworkers.filter((c) => c.id !== userId);

  const counts = {
    total: teamMembers.length,
    active: teamMembers.filter((c) => memberStatus(c, today) === "active").length,
    onLeave: teamMembers.filter((c) => memberStatus(c, today) === "on_leave").length,
    inactive: teamMembers.filter((c) => memberStatus(c, today) === "inactive").length,
  };

  const members = teamMembers.slice(0, 20).map((c) => ({
    name: formatEmployeeName({ full_name: c.full_name }),
    jobTitle: c.job_title,
    status: memberStatus(c, today),
  }));

  const pendingLeaveRequests = (
    (pendingLeavesRes.data ?? []) as Array<{
      status?: string;
      start_date?: string;
      end_date?: string;
      leave_types?: { name?: string | null; code?: string | null } | null;
      profiles?: {
        full_name?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      } | null;
    }>
  ).map((row) => ({
    employeeName: formatEmployeeName({
      full_name: row.profiles?.full_name,
      first_name: row.profiles?.first_name,
      last_name: row.profiles?.last_name,
    }),
    type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
    status: row.status ?? "pending_dept",
    from: row.start_date ?? "",
    to: row.end_date ?? "",
  }));

  const activeBreaks = (
    (activeBreaksRes.data ?? []) as Array<{
      full_name?: string;
      break_type?: string;
      duration_minutes?: number;
      status?: string;
    }>
  ).map((row) => ({
    employeeName: row.full_name ?? "—",
    breakType: row.break_type ?? null,
    durationMinutes: row.duration_minutes ?? null,
  }));

  const dailyBreaks = (
    (dailyBreaksRes.data ?? []) as Array<{
      full_name?: string;
      break_type?: string;
      status?: string;
      duration_minutes?: number;
    }>
  ).map((row) => ({
    employeeName: row.full_name ?? "—",
    breakType: row.break_type ?? null,
    status: row.status ?? "unknown",
    durationMinutes: row.duration_minutes ?? null,
  }));

  const scheduleThisWeek = departmentId
    ? await buildDepartmentScheduleSummary(supabase, departmentId, weekStart, weekDays)
    : { weekStart, days: [], note: "Department not set on profile." };

  const recentDepartmentTasks = departmentId
    ? await loadDepartmentTasks(supabase, userId, departmentId, 3)
    : [];

  return {
    role: "department_head",
    asOfDate: today,
    managerProfile: {
      name: formatEmployeeName({
        full_name: managerProfile?.full_name,
        first_name: managerProfile?.first_name,
        last_name: managerProfile?.last_name,
      }),
      jobTitle: managerProfile?.job_title ?? null,
      department: departmentName,
    },
    team: { counts, members },
    pendingLeaveRequests,
    breaksToday: {
      activeNow: activeBreaks,
      dailyLog: dailyBreaks,
    },
    scheduleThisWeek,
    recentDepartmentTasks,
    personal,
  };
}

/** Read-only context for AI prompts. Uses the caller's session (RLS). */
export async function buildAiUserContext(
  supabase: Db,
  assistantKind: AiAssistantKind,
): Promise<string | null> {
  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user?.id) return null;

  const userId = authData.user.id;

  try {
    if (assistantKind === "employee") {
      return JSON.stringify(await buildEmployeeSnapshot(supabase, userId), null, 2);
    }

    if (assistantKind === "manager") {
      const isBranchOp =
        (await userHasRole(supabase, userId, "branch_manager")) ||
        (await userHasRole(supabase, userId, "assistant_manager"));
      if (isBranchOp) {
        const { buildBranchOperatorSnapshot } = await import("@/lib/ai-context-branch.server");
        return JSON.stringify(await buildBranchOperatorSnapshot(supabase, userId), null, 2);
      }
      const isDeptHead = await userHasRole(supabase, userId, "department_manager");
      if (isDeptHead) {
        return JSON.stringify(await buildDeptHeadSnapshot(supabase, userId), null, 2);
      }
      return null;
    }

    return null;
  } catch {
    return null;
  }
}
