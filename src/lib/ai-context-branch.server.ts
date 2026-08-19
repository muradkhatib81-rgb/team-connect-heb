import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/constants";
import { isPlatformOwner } from "@/lib/constants";
import { getScheduleWeek } from "@/lib/schedule-week";
import { todayJerusalemDate } from "@/lib/break-workflow";
import { isEmployeeCurrentlyOnLeave, isEmployeeOnLeaveOnDate } from "@/lib/employee-leave";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
import { formatEmployeeName } from "@/lib/employee-name";
import {
  hasBranchActionPermission,
  type UserTaskPermissions,
} from "@/lib/use-current-permissions";
import { resolveLeaveAccess } from "@/lib/leave-permissions";
import { buildEmployeeSnapshot } from "@/lib/ai-context.server";

type Db = SupabaseClient<Database>;

type ProfileStaffRow = {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  is_active: boolean;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_code: string | null;
  department_id: string | null;
  branch_id: string | null;
  excluded_from_headcount: boolean | null;
  job_title: string | null;
};

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function loadRoles(supabase: Db, userId: string): Promise<AppRole[]> {
  const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  return (data ?? []).map((r) => r.role as AppRole);
}

async function loadPermissions(supabase: Db, userId: string): Promise<UserTaskPermissions | null> {
  const { data, error } = await supabase
    .from("user_task_permissions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function canManageBreaksServer(
  supabase: Db,
  userId: string,
  roles: AppRole[],
): Promise<boolean> {
  if (roles.includes("main_admin") || roles.includes("system_admin")) return true;
  if (!roles.includes("branch_manager") && !roles.includes("assistant_manager")) return false;
  const { data } = await supabase
    .from("user_task_permissions")
    .select("can_manage_breaks")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.can_manage_breaks;
}

function branchOperatorRole(roles: AppRole[]): "branch_manager" | "assistant_manager" | null {
  if (roles.includes("branch_manager")) return "branch_manager";
  if (roles.includes("assistant_manager")) return "assistant_manager";
  return null;
}

function leaveTypeLabel(code: string | null | undefined): "regular" | "sick" | "unknown" {
  if (code === "sick") return "sick";
  if (code === "regular") return "regular";
  return "unknown";
}

function summarizeLeaveOnDate(staff: ProfileStaffRow[], date: string, limit = 25) {
  const onLeave = staff.filter((p) => isEmployeeOnLeaveOnDate(p, date));
  const regular = onLeave.filter((p) => leaveTypeLabel(p.leave_type_code) === "regular");
  const sick = onLeave.filter((p) => leaveTypeLabel(p.leave_type_code) === "sick");
  return {
    date,
    total: onLeave.length,
    regular: regular.length,
    sick: sick.length,
    employees: onLeave.slice(0, limit).map((p) => ({
      name: formatEmployeeName(p),
      type: leaveTypeLabel(p.leave_type_code),
      from: p.leave_start_date,
      to: p.leave_end_date,
    })),
  };
}

function memberStatusFromProfile(p: ProfileStaffRow, today: string): "active" | "on_leave" | "inactive" {
  if (!p.is_active) return "inactive";
  if (isEmployeeCurrentlyOnLeave(p, today)) return "on_leave";
  return "active";
}

function leaveAvailableDays(row: {
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

type EmployeeLeaveSummary = {
  regularDays: number | null;
  sickDays: number | null;
  other: Array<{ type: string; availableDays: number }>;
};

async function loadLeaveBalancesByUser(
  supabase: Db,
  userIds: string[],
): Promise<Map<string, EmployeeLeaveSummary>> {
  const result = new Map<string, EmployeeLeaveSummary>();
  if (!userIds.length) return result;

  const { data, error } = await (supabase as any)
    .from("leave_balances")
    .select(
      "user_id, manual_balance, accrued_days, used_days, reserved_days, leave_types(code, name)",
    )
    .in("user_id", userIds);
  if (error) throw error;

  for (const row of (data ?? []) as Array<{
    user_id: string;
    manual_balance?: number | null;
    accrued_days?: number | null;
    used_days?: number | null;
    reserved_days?: number | null;
    leave_types?: { code?: string | null; name?: string | null } | null;
  }>) {
    const available = Math.round(leaveAvailableDays(row) * 100) / 100;
    const code = row.leave_types?.code ?? "unknown";
    const label = row.leave_types?.name ?? code;
    const current = result.get(row.user_id) ?? {
      regularDays: null,
      sickDays: null,
      other: [],
    };

    if (code === "regular") current.regularDays = available;
    else if (code === "sick") current.sickDays = available;
    else current.other.push({ type: label, availableDays: available });

    result.set(row.user_id, current);
  }

  return result;
}

async function loadContactsByUser(
  supabase: Db,
): Promise<Map<string, { phone: string | null; idNumber: string | null }>> {
  const { data, error } = await supabase.rpc("list_profiles_contact");
  if (error) return new Map();

  return new Map(
    (data ?? []).map((row: { id: string; phone: string | null; id_number: string | null }) => [
      row.id,
      { phone: row.phone ?? null, idNumber: row.id_number ?? null },
    ]),
  );
}

async function loadBranchDepartmentsDirectory(
  supabase: Db,
  branchId: string,
  staff: ProfileStaffRow[],
  today: string,
  opts: { includeLeaveBalances: boolean; includeContactDetails: boolean },
) {
  const { data: depts, error } = await supabase
    .from("departments")
    .select("id, name, code, manager_id")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;

  const managerIds = [
    ...new Set((depts ?? []).map((d) => d.manager_id).filter(Boolean)),
  ] as string[];

  const managerNameById = new Map<string, string>();
  if (managerIds.length) {
    const { data: managers } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name")
      .in("id", managerIds);
    for (const m of managers ?? []) {
      managerNameById.set(m.id, formatEmployeeName(m));
    }
  }

  const staffByDept = new Map<string, ProfileStaffRow[]>();
  for (const p of staff.filter((row) => !row.excluded_from_headcount)) {
    if (!p.department_id) continue;
    const list = staffByDept.get(p.department_id) ?? [];
    list.push(p);
    staffByDept.set(p.department_id, list);
  }

  const memberIds = [...staffByDept.values()]
    .flat()
    .map((p) => p.id)
    .filter((id) => !(depts ?? []).some((d) => d.manager_id === id));

  const leaveUserIds = opts.includeLeaveBalances
    ? [...new Set([...memberIds, ...managerIds])]
    : memberIds;

  const [leaveByUser, contactByUser] = await Promise.all([
    opts.includeLeaveBalances ? loadLeaveBalancesByUser(supabase, leaveUserIds) : Promise.resolve(new Map()),
    opts.includeContactDetails ? loadContactsByUser(supabase) : Promise.resolve(new Map()),
  ]);

  return (depts ?? []).map((dept) => {
    const headContact = dept.manager_id ? contactByUser.get(dept.manager_id) : undefined;
    const headLeave = dept.manager_id ? leaveByUser.get(dept.manager_id) : undefined;

    const members = (staffByDept.get(dept.id) ?? [])
      .filter((p) => p.id !== dept.manager_id)
      .sort((a, b) => formatEmployeeName(a).localeCompare(formatEmployeeName(b), "he"))
      .slice(0, 30)
      .map((p) => {
        const leave = leaveByUser.get(p.id);
        const contact = contactByUser.get(p.id);
        return {
          name: formatEmployeeName(p),
          jobTitle: p.job_title,
          status: memberStatusFromProfile(p, today),
          ...(leave
            ? {
                leaveBalance: {
                  regularDays: leave.regularDays,
                  sickDays: leave.sickDays,
                  other: leave.other.length ? leave.other : undefined,
                },
              }
            : {}),
          ...(contact?.phone ? { phone: contact.phone } : {}),
        };
      });

    return {
      name: dept.name,
      code: dept.code,
      headName: dept.manager_id ? (managerNameById.get(dept.manager_id) ?? null) : null,
      ...(headContact?.phone ? { headPhone: headContact.phone } : {}),
      ...(headLeave
        ? {
            headLeaveBalance: {
              regularDays: headLeave.regularDays,
              sickDays: headLeave.sickDays,
              other: headLeave.other.length ? headLeave.other : undefined,
            },
          }
        : {}),
      employeeCount: members.length,
      employees: members,
    };
  });
}

async function loadBranchStaff(supabase: Db, branchId: string): Promise<ProfileStaffRow[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id, full_name, first_name, last_name, is_active, on_leave, leave_start_date, leave_end_date, leave_type_code, department_id, branch_id, excluded_from_headcount, job_title",
    )
    .eq("branch_id", branchId);
  if (error) throw error;
  return ((data ?? []) as ProfileStaffRow[]).filter((p) => !isNonEmployeeIdentity(p));
}

async function loadTomorrowScheduleCounts(
  supabase: Db,
  branchId: string,
  tomorrow: string,
  weekStart: string,
) {
  const { data: depts } = await supabase
    .from("departments")
    .select("id, name")
    .eq("branch_id", branchId)
    .eq("is_active", true);

  const { data: scheds } = await supabase
    .from("schedules")
    .select("id, department_id")
    .eq("branch_id", branchId)
    .eq("week_start", weekStart)
    .eq("status", "approved")
    .not("published_at", "is", null);

  const scheduleIds = (scheds ?? []).map((s) => s.id);
  if (!scheduleIds.length) {
    return {
      date: tomorrow,
      note: "No published branch schedules for this week.",
      totalScheduled: 0,
      byDepartment: [] as Array<{
        department: string;
        morning: number;
        evening: number;
        off: number;
        onLeave: number;
      }>,
    };
  }

  const { data: shifts } = await (supabase as any)
    .from("schedule_shifts")
    .select("department_id, shift, leave_type_code, schedule_id")
    .in("schedule_id", scheduleIds)
    .eq("day_date", tomorrow);

  const deptName = new Map((depts ?? []).map((d) => [d.id, d.name]));
  const schedDept = new Map((scheds ?? []).map((s) => [s.id, s.department_id]));

  const byDept = new Map<
    string,
    { morning: number; evening: number; off: number; onLeave: number }
  >();

  for (const row of (shifts ?? []) as Array<{
    shift: string;
    leave_type_code?: string | null;
    schedule_id: string;
  }>) {
    const deptId = schedDept.get(row.schedule_id);
    if (!deptId) continue;
    const bucket = byDept.get(deptId) ?? { morning: 0, evening: 0, off: 0, onLeave: 0 };
    if (row.leave_type_code) bucket.onLeave += 1;
    else if (row.shift === "morning") bucket.morning += 1;
    else if (row.shift === "evening") bucket.evening += 1;
    else bucket.off += 1;
    byDept.set(deptId, bucket);
  }

  let totalScheduled = 0;
  const byDepartment = Array.from(byDept.entries()).map(([deptId, counts]) => {
    const sum = counts.morning + counts.evening + counts.off + counts.onLeave;
    totalScheduled += sum;
    return { department: deptName.get(deptId) ?? deptId, ...counts };
  });

  return { date: tomorrow, totalScheduled, byDepartment };
}

async function loadBreakJournal(supabase: Db, today: string) {
  const dayStart = `${today}T00:00:00+03:00`;
  const dayEnd = `${today}T23:59:59.999+03:00`;

  const [{ data: active }, { data: daily }] = await Promise.all([
    supabase
      .from("break_requests")
      .select("id, user_id, department_id, break_setting_id, started_at, ends_at, duration_minutes, status")
      .eq("status", "active"),
    supabase
      .from("break_requests")
      .select(
        "id, user_id, department_id, break_setting_id, status, duration_minutes, requested_at, started_at, completed_at, created_at",
      )
      .gte("created_at", dayStart)
      .lte("created_at", dayEnd)
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const rows = [...(active ?? []), ...(daily ?? [])];
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const deptIds = [...new Set(rows.map((r) => r.department_id).filter(Boolean))] as string[];
  const settingIds = [...new Set(rows.map((r) => r.break_setting_id))];

  const [{ data: profs }, { data: depts }, { data: settings }] = await Promise.all([
    userIds.length
      ? supabase.from("profiles").select("id, full_name, first_name, last_name").in("id", userIds)
      : Promise.resolve({ data: [] }),
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds)
      : Promise.resolve({ data: [] }),
    settingIds.length
      ? supabase.from("break_settings").select("id, name").in("id", settingIds)
      : Promise.resolve({ data: [] }),
  ]);

  const profMap = new Map(
    (profs ?? []).map((p) => [
      p.id,
      formatEmployeeName({
        full_name: p.full_name,
        first_name: p.first_name,
        last_name: p.last_name,
      }),
    ]),
  );
  const deptMap = new Map((depts ?? []).map((d) => [d.id, d.name]));
  const settingMap = new Map((settings ?? []).map((s) => [s.id, s.name]));

  const mapRow = (r: (typeof rows)[number]) => ({
    employeeName: profMap.get(r.user_id) ?? "—",
    department: r.department_id ? (deptMap.get(r.department_id) ?? "—") : "—",
    breakType: settingMap.get(r.break_setting_id) ?? "—",
    status: r.status,
    durationMinutes: r.duration_minutes,
    startedAt: r.started_at,
    endsAt: r.ends_at,
  });

  return {
    activeNow: (active ?? []).map(mapRow),
    dailyLog: (daily ?? []).map(mapRow),
  };
}

async function loadCustodyJournal(supabase: Db, branchId: string, today: string) {
  const dayStart = `${today}T00:00:00+03:00`;
  const dayEnd = `${today}T23:59:59.999+03:00`;

  const [{ data: archive }, { data: active }] = await Promise.all([
    supabase
      .from("custody_session_archive")
      .select(
        "id, item_name, user_name, department_name, checked_out_at, returned_at, duration_minutes, return_type",
      )
      .eq("branch_id", branchId)
      .gte("returned_at", dayStart)
      .lte("returned_at", dayEnd)
      .order("returned_at", { ascending: false })
      .limit(30),
    supabase
      .from("custody_checkouts")
      .select("id, checked_out_at, user_id, department_id, item_type_id")
      .eq("branch_id", branchId)
      .eq("status", "active")
      .limit(20),
  ]);

  const activeRows = active ?? [];
  const typeIds = [...new Set(activeRows.map((r) => r.item_type_id))];
  const userIds = [...new Set(activeRows.map((r) => r.user_id))];

  const [{ data: types }, { data: profs }] = await Promise.all([
    typeIds.length
      ? supabase.from("custody_item_types").select("id, name").in("id", typeIds)
      : Promise.resolve({ data: [] }),
    userIds.length
      ? supabase.from("profiles").select("id, full_name, first_name, last_name").in("id", userIds)
      : Promise.resolve({ data: [] }),
  ]);

  const typeMap = new Map((types ?? []).map((t) => [t.id, t.name]));
  const profMap = new Map(
    (profs ?? []).map((p) => [
      p.id,
      formatEmployeeName({
        full_name: p.full_name,
        first_name: p.first_name,
        last_name: p.last_name,
      }),
    ]),
  );

  return {
    returnedToday: (archive ?? []).map((r) => ({
      itemName: r.item_name,
      userName: r.user_name,
      department: r.department_name,
      durationMinutes: r.duration_minutes,
      returnType: r.return_type,
    })),
    stillOut: activeRows.map((r) => ({
      itemName: typeMap.get(r.item_type_id) ?? "—",
      userName: profMap.get(r.user_id) ?? "—",
      checkedOutAt: r.checked_out_at,
    })),
  };
}

async function loadScheduleLastModified(supabase: Db, branchId: string, weekStart: string) {
  const { data: scheds } = await supabase
    .from("schedules")
    .select(
      "id, department_id, status, week_start, updated_at, updated_by, published_at, submitted_at, approved_at, departments(name)",
    )
    .eq("branch_id", branchId)
    .eq("week_start", weekStart)
    .order("updated_at", { ascending: false })
    .limit(20);

  const results = [];
  for (const sched of scheds ?? []) {
    const { data: audit } = await supabase
      .from("schedule_audit_log")
      .select("action, created_at, actor_id")
      .eq("schedule_id", sched.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let actorName: string | null = null;
    if (audit?.actor_id) {
      const { data: actor } = await supabase
        .from("profiles")
        .select("full_name, first_name, last_name")
        .eq("id", audit.actor_id)
        .maybeSingle();
      if (actor) {
        actorName = formatEmployeeName(actor);
      }
    }

    results.push({
      department: (sched as { departments?: { name?: string | null } }).departments?.name ?? null,
      weekStart: sched.week_start,
      status: sched.status,
      lastAction: audit?.action ?? null,
      lastModifiedAt: audit?.created_at ?? sched.updated_at,
      lastModifiedBy: actorName,
      publishedAt: sched.published_at,
    });
  }
  return results;
}

function canAccessCustody(roles: AppRole[], perms: UserTaskPermissions | null): boolean {
  if (isPlatformOwner(roles)) return true;
  if (!perms) return false;
  return !!(
    perms.can_create_custody ||
    perms.can_edit_custody ||
    perms.can_delete_custody ||
    perms.can_return_custody ||
    perms.can_receive_custody_alerts ||
    perms.can_configure_custody ||
    perms.can_view_custody_daily_log ||
    perms.can_run_custody_monthly_report
  );
}

async function canManageEomServer(
  supabase: Db,
  userId: string,
  roles: AppRole[],
): Promise<boolean> {
  if (roles.includes("main_admin") || roles.includes("system_admin")) return true;
  if (roles.includes("branch_manager")) return true;
  if (!roles.includes("assistant_manager")) return false;
  const { data } = await supabase
    .from("user_task_permissions")
    .select("can_manage_employee_of_month")
    .eq("user_id", userId)
    .maybeSingle();
  return !!data?.can_manage_employee_of_month;
}

function eomMonthKey(year: number, month: number): number {
  return year * 12 + month;
}

function eomMonthsAgo(year: number, month: number, monthsBack: number): { year: number; month: number } {
  let m = month - monthsBack;
  let y = year;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
}

async function loadEmployeeOfMonthHistory(
  supabase: Db,
  branchId: string,
  today: string,
  canViewFullHistory: boolean,
) {
  const [yearStr, monthStr] = today.split("-");
  const currentYear = Number(yearStr);
  const currentMonth = Number(monthStr);

  const { data: rows, error } = await supabase
    .from("employee_of_month")
    .select("id, year, month, employee_id, reason")
    .eq("branch_id", branchId)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(120);
  if (error) throw error;

  const list = rows ?? [];
  if (!list.length) {
    return {
      currentMonth: { year: currentYear, month: currentMonth, winners: [] as unknown[] },
      last12Months: [] as unknown[],
      historyScope: canViewFullHistory ? "full_12_months" : "current_month_only",
    };
  }

  const cutoff = eomMonthsAgo(currentYear, currentMonth, 11);
  const cutoffKey = eomMonthKey(cutoff.year, cutoff.month);

  const inWindow = list.filter((row) => eomMonthKey(row.year, row.month) >= cutoffKey);

  const employeeIds = [...new Set(inWindow.map((r) => r.employee_id))];
  const profileById = new Map<
    string,
    { name: string; department: string | null; jobTitle: string | null }
  >();

  if (employeeIds.length) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, first_name, last_name, job_title, departments(name)")
      .in("id", employeeIds);

    for (const p of profiles ?? []) {
      profileById.set(p.id, {
        name: formatEmployeeName(p),
        department: (p as { departments?: { name?: string | null } | null }).departments?.name ?? null,
        jobTitle: p.job_title,
      });
    }
  }

  const grouped = new Map<string, Array<{ name: string; department: string | null; jobTitle: string | null; reason: string | null }>>();
  for (const row of inWindow) {
    const key = `${row.year}-${row.month}`;
    const profile = profileById.get(row.employee_id);
    const entry = {
      name: profile?.name ?? row.employee_id,
      department: profile?.department ?? null,
      jobTitle: profile?.jobTitle ?? null,
      reason: row.reason,
    };
    const bucket = grouped.get(key) ?? [];
    bucket.push(entry);
    grouped.set(key, bucket);
  }

  const last12Months = [...grouped.entries()]
    .map(([key, winners]) => {
      const [y, m] = key.split("-").map(Number);
      return { year: y, month: m, winners };
    })
    .sort((a, b) => eomMonthKey(b.year, b.month) - eomMonthKey(a.year, a.month));

  const currentKey = `${currentYear}-${currentMonth}`;
  const currentWinners = grouped.get(currentKey) ?? [];

  return {
    currentMonth: { year: currentYear, month: currentMonth, winners: currentWinners },
    last12Months,
    historyScope: canViewFullHistory ? "full_12_months" : "current_month_only",
  };
}

/** Read-only branch operator snapshot (BM / assistant manager), gated by grants. */
export async function buildBranchOperatorSnapshot(supabase: Db, userId: string) {
  const today = jerusalemTodayIso();
  const tomorrow = addDaysIso(today, 1);
  const { weekStart } = getScheduleWeek(new Date(`${today}T12:00:00Z`));

  const [roles, perms] = await Promise.all([
    loadRoles(supabase, userId),
    loadPermissions(supabase, userId),
  ]);

  const operatorRole = branchOperatorRole(roles);
  if (!operatorRole) {
    throw new Error("Not a branch operator");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("branch_id, full_name, first_name, last_name, job_title")
    .eq("id", userId)
    .maybeSingle();

  const branchId = (profile?.branch_id as string | null) ?? null;
  const leaveAccess = resolveLeaveAccess(roles, perms);
  const canManageBreaks = await canManageBreaksServer(supabase, userId, roles);
  const canViewSchedule = hasBranchActionPermission(roles, perms, "can_view_schedule");
  const canViewTasks = hasBranchActionPermission(roles, perms, "can_view_tasks");
  const canViewCustody = canAccessCustody(roles, perms);

  const canViewEmployeeDetails = hasBranchActionPermission(
    roles,
    perms,
    "can_view_employee_details",
  );
  const canManageEmployeeOfMonth = await canManageEomServer(supabase, userId, roles);

  const snapshot: Record<string, unknown> = {
    role: operatorRole,
    asOfDate: today,
    branchId,
    grants: {
      canManageBreaks,
      canViewSchedule,
      canViewTasks,
      canViewLeave: leaveAccess.canView,
      canViewCustody,
      canViewEmployeeDetails,
      canManageEmployeeOfMonth,
    },
    operationalErrors: {
      available: false,
      note: "Operational error journal is planned — not available yet.",
    },
    personal: await buildEmployeeSnapshot(supabase, userId),
  };

  if (!branchId) {
    snapshot.note = "Branch not set on profile.";
    return snapshot;
  }

  const staff = await loadBranchStaff(supabase, branchId);
  const counted = staff.filter((p) => !p.excluded_from_headcount);

  const { data: activeBreaks } = await supabase
    .from("break_requests")
    .select("user_id")
    .eq("status", "active");
  const onBreakIds = new Set((activeBreaks ?? []).map((b) => b.user_id));

  const { data: depts } = await supabase
    .from("departments")
    .select("id, name")
    .eq("branch_id", branchId)
    .eq("is_active", true);

  const byDept: Record<string, { name: string; count: number }> = {};
  for (const d of depts ?? []) {
    byDept[d.id] = { name: d.name, count: 0 };
  }
  for (const p of counted) {
    if (p.department_id && byDept[p.department_id]) {
      byDept[p.department_id].count += 1;
    }
  }

  snapshot.headcount = {
    today: {
      total: counted.length,
      active: counted.filter((p) => p.is_active && !isEmployeeCurrentlyOnLeave(p, today)).length,
      inactive: counted.filter((p) => !p.is_active).length,
      onBreak: counted.filter((p) => onBreakIds.has(p.id)).length,
      onLeave: summarizeLeaveOnDate(counted, today),
    },
    byDepartment: Object.values(byDept),
  };

  snapshot.departmentsDirectory = await loadBranchDepartmentsDirectory(
    supabase,
    branchId,
    staff,
    today,
    {
      includeLeaveBalances: leaveAccess.canView,
      includeContactDetails: canViewEmployeeDetails,
    },
  );

  snapshot.employeeOfMonth = await loadEmployeeOfMonthHistory(
    supabase,
    branchId,
    today,
    canManageEmployeeOfMonth,
  );

  if (canViewSchedule) {
    snapshot.tomorrowSchedule = await loadTomorrowScheduleCounts(
      supabase,
      branchId,
      tomorrow,
      weekStart,
    );
    snapshot.scheduleLastModified = await loadScheduleLastModified(supabase, branchId, weekStart);
  }

  snapshot.leaveTomorrow = summarizeLeaveOnDate(counted, tomorrow);

  if (canManageBreaks) {
    snapshot.breakJournal = await loadBreakJournal(supabase, today);
  }

  if (canViewCustody) {
    snapshot.custodyJournal = await loadCustodyJournal(supabase, branchId, today);
  }

  if (leaveAccess.canView) {
    const { data: pendingAdmin } = await (supabase as any)
      .from("leave_requests")
      .select(
        "status, start_date, end_date, leave_types(name, code), profiles!user_id(full_name, first_name, last_name)",
      )
      .eq("status", "pending_admin")
      .order("submitted_at", { ascending: false })
      .limit(15);

    snapshot.pendingAdminLeaveRequests = ((pendingAdmin ?? []) as Array<{
      status?: string;
      start_date?: string;
      end_date?: string;
      leave_types?: { name?: string | null; code?: string | null } | null;
      profiles?: {
        full_name?: string | null;
        first_name?: string | null;
        last_name?: string | null;
      } | null;
    }>).map((row) => ({
      employeeName: formatEmployeeName({
        full_name: row.profiles?.full_name,
        first_name: row.profiles?.first_name,
        last_name: row.profiles?.last_name,
      }),
      type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
      from: row.start_date ?? "",
      to: row.end_date ?? "",
      status: row.status ?? "pending_admin",
    }));
  }

  if (canViewTasks) {
    const { data: tasks } = await supabase
      .from("tasks")
      .select("title, status, due_at, created_at, department_id, departments(name)")
      .eq("branch_id", branchId)
      .neq("status", "closed")
      .order("created_at", { ascending: false })
      .limit(5);

    snapshot.recentBranchTasks = (tasks ?? []).map((t) => ({
      title: t.title,
      status: t.status,
      dueAt: t.due_at,
      department: (t as { departments?: { name?: string | null } }).departments?.name ?? null,
    }));
  }

  return snapshot;
}

function jerusalemTodayIso(): string {
  return todayJerusalemDate();
}
