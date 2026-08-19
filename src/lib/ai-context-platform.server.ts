import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { todayJerusalemDate } from "@/lib/break-workflow";
import { formatEmployeeName } from "@/lib/employee-name";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
import { getSupabasePublishableKey, getSupabaseUrl } from "@/integrations/supabase/server-env.server";

type Db = SupabaseClient<Database>;

type ProfileStaffRow = {
  id: string;
  full_name: string | null;
  first_name?: string | null;
  last_name?: string | null;
  job_title: string | null;
  department_id: string | null;
  branch_id: string | null;
  excluded_from_headcount: boolean | null;
};

type HealthState = "healthy" | "degraded" | "down" | "unknown";

type IssueSeverity = "critical" | "warning" | "info";

type OperationalIssue = {
  severity: IssueSeverity;
  scope: "platform" | "infrastructure" | "company" | "branch" | "department";
  companyName: string | null;
  branchName: string | null;
  departmentName: string | null;
  component: string | null;
  message: string;
};

const AUDIT_EVENT_LABELS: Record<string, string> = {
  "owner.created": "Platform owner created",
  "owner.suspended": "Platform owner suspended",
  "owner.restored": "Platform owner restored",
  "owner.deleted": "Platform owner deleted",
  "owner.primary_transferred": "Primary ownership transferred",
  "owner.profile_updated": "Platform owner profile updated",
};

function jerusalemTodayIso(): string {
  return todayJerusalemDate();
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function resolvePrimaryOwnerUserId(byUser: Map<string, Set<string>>): string | null {
  for (const [id, roles] of byUser) {
    if (roles.has("system_admin")) return id;
  }
  const mainAdminIds = [...byUser.entries()]
    .filter(([, roles]) => roles.has("main_admin"))
    .map(([id]) => id)
    .sort();
  return mainAdminIds[0] ?? null;
}

async function assertPlatformOwner(supabase: Db, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["system_admin", "main_admin"]);
  if (error) throw error;
  if (!(data ?? []).length) throw new Error("Not a platform owner");
}

async function loadPlatformOwnersSummary(supabase: Db) {
  const { data: roles, error } = await supabase
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["system_admin", "main_admin"]);
  if (error) throw error;

  const byUser = new Map<string, Set<string>>();
  for (const row of roles ?? []) {
    const set = byUser.get(row.user_id) ?? new Set<string>();
    set.add(row.role);
    byUser.set(row.user_id, set);
  }

  const ids = [...byUser.keys()];
  if (!ids.length) {
    return { activeCount: 0, suspendedCount: 0, primary: null, owners: [] as unknown[] };
  }

  const primaryUserId = resolvePrimaryOwnerUserId(byUser);

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, first_name, last_name, is_active, phone")
    .in("id", ids);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const owners = ids
    .map((id) => {
      const p = profileById.get(id);
      const roleSet = byUser.get(id)!;
      return {
        name: p ? formatEmployeeName(p) : id,
        level: roleSet.has("system_admin") ? "primary" : "owner",
        isPrimary: id === primaryUserId,
        isActive: p?.is_active ?? true,
        phone: p?.phone ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "he"));

  const activeCount = owners.filter((o) => o.isActive).length;
  const primary = owners.find((o) => o.isPrimary) ?? null;

  return {
    activeCount,
    suspendedCount: owners.length - activeCount,
    primary: primary ? { name: primary.name, isActive: primary.isActive, phone: primary.phone } : null,
    owners,
  };
}

async function loadTenantsSummary(supabase: Db) {
  const [{ data: companies, error: companiesErr }, { data: assignments, error: assignErr }, { data: realBranches, error: branchesErr }] =
    await Promise.all([
      (supabase as any)
        .from("companies")
        .select("id, name, status, company_code, phone, email, created_at")
        .is("deleted_at", null)
        .order("name"),
      (supabase as any)
        .from("company_branch_assignments")
        .select("id, company_id, source_branch_id, name, code, is_active")
        .is("deleted_at", null)
        .order("name"),
      supabase.from("branches").select("id, name, code, is_active").order("name"),
    ]);

  if (companiesErr) throw companiesErr;
  if (assignErr) throw assignErr;
  if (branchesErr) throw branchesErr;

  const branchesByCompany = new Map<string, typeof assignments>();
  for (const row of assignments ?? []) {
    const list = branchesByCompany.get(row.company_id) ?? [];
    list.push(row);
    branchesByCompany.set(row.company_id, list);
  }

  const assignedSourceIds = new Set((assignments ?? []).map((a) => a.source_branch_id));
  const unassignedRealBranches = (realBranches ?? []).filter((b) => !assignedSourceIds.has(b.id));

  const { data: staffCounts } = await supabase
    .from("profiles")
    .select("branch_id")
    .not("branch_id", "is", null)
    .eq("is_active", true);

  const employeesByBranch = new Map<string, number>();
  for (const row of staffCounts ?? []) {
    if (!row.branch_id) continue;
    employeesByBranch.set(row.branch_id, (employeesByBranch.get(row.branch_id) ?? 0) + 1);
  }

  const companySummaries = (companies ?? []).slice(0, 50).map((c) => {
    const companyBranches = branchesByCompany.get(c.id) ?? [];
    return {
      id: c.id,
      name: c.name,
      status: c.status,
      code: c.company_code,
      phone: c.phone,
      email: c.email,
      branchCount: companyBranches.length,
      branches: companyBranches.slice(0, 20).map((b) => ({
        name: b.name,
        code: b.code,
        isActive: b.is_active,
        employeeCount: employeesByBranch.get(b.source_branch_id) ?? 0,
      })),
    };
  });

  return {
    companiesCount: (companies ?? []).length,
    branchAssignmentsCount: (assignments ?? []).length,
    realBranchesCount: (realBranches ?? []).length,
    unassignedRealBranchesCount: unassignedRealBranches.length,
    unassignedRealBranches: unassignedRealBranches.slice(0, 15).map((b) => ({
      name: b.name,
      code: b.code,
      isActive: b.is_active,
    })),
    companies: companySummaries,
    branchMeta: (realBranches ?? []).map((b) => {
      const assignment = (assignments ?? []).find((a) => a.source_branch_id === b.id);
      const company = assignment
        ? (companies ?? []).find((c) => c.id === assignment.company_id)
        : null;
      return {
        id: b.id,
        name: b.name,
        code: b.code ?? null,
        companyName: company?.name ?? null,
        isActive: b.is_active ?? true,
      };
    }),
  };
}

async function loadContactsByUser(
  supabase: Db,
): Promise<Map<string, { phone: string | null }>> {
  const { data, error } = await supabase.rpc("list_profiles_contact");
  if (error) return new Map();

  return new Map(
    (data ?? []).map((row: { id: string; phone: string | null }) => [
      row.id,
      { phone: row.phone ?? null },
    ]),
  );
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

function formatLeaveBalance(leave: EmployeeLeaveSummary | undefined) {
  if (!leave) return undefined;
  return {
    regularDays: leave.regularDays,
    sickDays: leave.sickDays,
    other: leave.other.length ? leave.other : undefined,
  };
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

type EomWinner = {
  name: string;
  department: string | null;
  jobTitle: string | null;
  reason: string | null;
};

type BranchEomSnapshot = {
  currentMonth: { year: number; month: number; winners: EomWinner[] };
  last12Months: Array<{ year: number; month: number; winners: EomWinner[] }>;
  historyScope: "full_12_months";
};

async function loadEmployeeOfMonthByBranch(
  supabase: Db,
  branchIds: string[],
  today: string,
): Promise<Map<string, BranchEomSnapshot>> {
  const result = new Map<string, BranchEomSnapshot>();
  if (!branchIds.length) return result;

  const [yearStr, monthStr] = today.split("-");
  const currentYear = Number(yearStr);
  const currentMonth = Number(monthStr);
  const cutoff = eomMonthsAgo(currentYear, currentMonth, 11);
  const cutoffKey = eomMonthKey(cutoff.year, cutoff.month);

  for (const branchId of branchIds) {
    result.set(branchId, {
      currentMonth: { year: currentYear, month: currentMonth, winners: [] },
      last12Months: [],
      historyScope: "full_12_months",
    });
  }

  const { data: rows, error } = await supabase
    .from("employee_of_month")
    .select("branch_id, year, month, employee_id, reason")
    .in("branch_id", branchIds)
    .order("year", { ascending: false })
    .order("month", { ascending: false })
    .limit(500);
  if (error) throw error;

  const inWindow = (rows ?? []).filter(
    (row) =>
      row.branch_id &&
      eomMonthKey(row.year, row.month) >= cutoffKey,
  );

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

  const groupedByBranch = new Map<string, Map<string, EomWinner[]>>();
  for (const row of inWindow) {
    if (!row.branch_id) continue;
    const monthKey = `${row.year}-${row.month}`;
    const profile = profileById.get(row.employee_id);
    const winner: EomWinner = {
      name: profile?.name ?? row.employee_id,
      department: profile?.department ?? null,
      jobTitle: profile?.jobTitle ?? null,
      reason: row.reason,
    };

    const branchBuckets = groupedByBranch.get(row.branch_id) ?? new Map<string, EomWinner[]>();
    const monthWinners = branchBuckets.get(monthKey) ?? [];
    monthWinners.push(winner);
    branchBuckets.set(monthKey, monthWinners);
    groupedByBranch.set(row.branch_id, branchBuckets);
  }

  for (const branchId of branchIds) {
    const monthBuckets = groupedByBranch.get(branchId);
    if (!monthBuckets) continue;

    const last12Months = [...monthBuckets.entries()]
      .map(([key, winners]) => {
        const [y, m] = key.split("-").map(Number);
        return { year: y, month: m, winners };
      })
      .sort((a, b) => eomMonthKey(b.year, b.month) - eomMonthKey(a.year, a.month));

    const currentKey = `${currentYear}-${currentMonth}`;
    result.set(branchId, {
      currentMonth: {
        year: currentYear,
        month: currentMonth,
        winners: monthBuckets.get(currentKey) ?? [],
      },
      last12Months,
      historyScope: "full_12_months",
    });
  }

  return result;
}

async function loadBranchOperationalDirectories(
  supabase: Db,
  branches: Array<{
    id: string;
    name: string;
    code: string | null;
    companyName: string | null;
    isActive?: boolean;
  }>,
  today: string,
) {
  const branchRows = branches.slice(0, 40);
  const branchIds = branchRows.map((b) => b.id);
  if (!branchIds.length) return [];

  const [{ data: depts, error: deptsErr }, { data: profiles, error: profErr }, contactByUser] =
    await Promise.all([
      supabase
        .from("departments")
        .select("id, name, code, manager_id, branch_id")
        .in("branch_id", branchIds)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("profiles")
        .select(
          "id, full_name, first_name, last_name, job_title, department_id, branch_id, excluded_from_headcount",
        )
        .in("branch_id", branchIds),
      loadContactsByUser(supabase),
    ]);

  if (deptsErr) throw deptsErr;
  if (profErr) throw profErr;

  const staff = (profiles ?? []).filter(
    (p) => !isNonEmployeeIdentity(p) && !p.excluded_from_headcount,
  ) as ProfileStaffRow[];

  const managerIds = [...new Set((depts ?? []).map((d) => d.manager_id).filter(Boolean))] as string[];
  const leaveUserIds = [...new Set([...staff.map((p) => p.id), ...managerIds])];
  const leaveByUser = await loadLeaveBalancesByUser(supabase, leaveUserIds);
  const eomByBranch = await loadEmployeeOfMonthByBranch(supabase, branchIds, today);
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

  const deptsByBranch = new Map<string, NonNullable<typeof depts>>();
  for (const dept of depts ?? []) {
    const list = deptsByBranch.get(dept.branch_id) ?? [];
    list.push(dept);
    deptsByBranch.set(dept.branch_id, list);
  }

  const staffByDept = new Map<string, ProfileStaffRow[]>();
  for (const p of staff) {
    if (!p.department_id) continue;
    const list = staffByDept.get(p.department_id) ?? [];
    list.push(p);
    staffByDept.set(p.department_id, list);
  }

  return branchRows.map((branch) => {
    const branchStaff = staff.filter((p) => p.branch_id === branch.id);
    const unassignedStaff = branchStaff.filter((p) => !p.department_id);
    const departmentsDirectory = (deptsByBranch.get(branch.id) ?? []).map((dept) => {
      const headContact = dept.manager_id ? contactByUser.get(dept.manager_id) : undefined;
      const headLeave = dept.manager_id ? leaveByUser.get(dept.manager_id) : undefined;
      const members = (staffByDept.get(dept.id) ?? [])
        .filter((p) => p.id !== dept.manager_id)
        .sort((a, b) => formatEmployeeName(a).localeCompare(formatEmployeeName(b), "he"))
        .slice(0, 25)
        .map((p) => {
          const contact = contactByUser.get(p.id);
          const leave = leaveByUser.get(p.id);
          return {
            name: formatEmployeeName(p),
            jobTitle: p.job_title,
            ...(contact?.phone ? { phone: contact.phone } : {}),
            ...(leave ? { leaveBalance: formatLeaveBalance(leave) } : {}),
          };
        });

      return {
        name: dept.name,
        code: dept.code,
        headName: dept.manager_id ? (managerNameById.get(dept.manager_id) ?? null) : null,
        ...(headContact?.phone ? { headPhone: headContact.phone } : {}),
        ...(headLeave ? { headLeaveBalance: formatLeaveBalance(headLeave) } : {}),
        employeeCount: members.length,
        employees: members,
      };
    });

    return {
      branchId: branch.id,
      branchName: branch.name,
      branchCode: branch.code,
      companyName: branch.companyName,
      isActive: branch.isActive ?? true,
      employeeCount: branchStaff.length,
      unassignedEmployeeCount: unassignedStaff.length,
      unassignedEmployees: unassignedStaff
        .slice(0, 8)
        .map((p) => formatEmployeeName(p)),
      departmentsDirectory,
      employeeOfMonth: eomByBranch.get(branch.id) ?? {
        currentMonth: {
          year: Number(today.split("-")[0]),
          month: Number(today.split("-")[1]),
          winners: [],
        },
        last12Months: [],
        historyScope: "full_12_months" as const,
      },
    };
  });
}

async function loadAiSummary(supabase: Db) {
  const [
    { data: settings },
    { data: providers },
    { data: entitlements },
    { data: grants },
    { data: usage },
  ] = await Promise.all([
    supabase.from("ai_platform_settings").select("*").maybeSingle(),
    supabase.from("ai_providers").select("code, display_name, is_enabled, sort_order").order("sort_order"),
    supabase.from("ai_plan_entitlements").select("billing_plan, monthly_minutes, default_provider_code"),
    supabase.from("ai_grants").select(
      "scope_type, scope_id, billing_plan, grant_source, quota_minutes, used_minutes, is_active, provider_code",
    ),
    supabase
      .from("ai_usage_events")
      .select("assistant_kind, provider_code, duration_ms, input_tokens, output_tokens, created_at")
      .order("created_at", { ascending: false })
      .limit(15),
  ]);

  const activeGrants = (grants ?? []).filter((g) => g.is_active);
  const grantsByScope = {
    company: activeGrants.filter((g) => g.scope_type === "company").length,
    branch: activeGrants.filter((g) => g.scope_type === "branch").length,
    user: activeGrants.filter((g) => g.scope_type === "user").length,
  };

  const totalUsedMinutes =
    Math.round(
      activeGrants.reduce((sum, g) => sum + (g.used_minutes ?? 0), 0) * 100,
    ) / 100;

  return {
    isGloballyEnabled: settings?.is_globally_enabled ?? null,
    defaultProvider: settings?.default_provider_code ?? null,
    ownerQuotaMinutes: settings?.owner_monthly_minutes ?? null,
    ownerUsedMinutes: settings?.owner_used_minutes ?? null,
    providers: (providers ?? []).map((p) => ({
      code: p.code,
      name: p.display_name,
      isEnabled: p.is_enabled,
    })),
    planEntitlements: (entitlements ?? []).map((e) => ({
      billingPlan: e.billing_plan,
      monthlyMinutes: e.monthly_minutes,
      defaultProvider: e.default_provider_code,
    })),
    grants: {
      activeCount: activeGrants.length,
      byScope: grantsByScope,
      totalUsedMinutes,
      companyGrants: activeGrants
        .filter((g) => g.scope_type === "company")
        .slice(0, 30)
        .map((g) => ({
          scopeId: g.scope_id,
          billingPlan: g.billing_plan,
          grantSource: g.grant_source,
          quotaMinutes: g.quota_minutes,
          usedMinutes: g.used_minutes,
          providerCode: g.provider_code,
        })),
    },
    recentUsage: (usage ?? []).map((u) => ({
      assistantKind: u.assistant_kind,
      providerCode: u.provider_code,
      durationMs: u.duration_ms,
      tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
      at: u.created_at,
    })),
  };
}

async function loadAuditSummary(supabase: Db) {
  const cutoff30d = addDaysIso(jerusalemTodayIso(), -30);
  const { data, error } = await supabase
    .from("platform_owner_audit_log")
    .select("event, created_at, actor_id, target_user_id")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const events30d = (data ?? []).filter((e) => e.created_at.slice(0, 10) >= cutoff30d).length;

  return {
    eventsLast30Days: events30d,
    recent: (data ?? []).slice(0, 10).map((e) => ({
      event: e.event,
      eventLabel: AUDIT_EVENT_LABELS[e.event] ?? e.event,
      at: e.created_at,
    })),
  };
}

async function loadPlatformSettings(supabase: Db) {
  const { data, error } = await supabase
    .from("platform_settings")
    .select("whatsapp_number, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) return { whatsappNumber: null, note: "platform_settings unavailable" };
  return {
    whatsappNumber: data?.whatsapp_number ?? null,
    updatedAt: data?.updated_at ?? null,
  };
}

function latencyState(ms: number, ok: boolean): HealthState {
  if (!ok) return "down";
  if (ms >= 4000) return "degraded";
  if (ms >= 1500) return "degraded";
  return "healthy";
}

async function loadHealthSummary(supabase: Db) {
  const checks: Array<{ target: string; state: HealthState; message: string }> = [];

  const supabaseUrl = getSupabaseUrl();
  const supabaseKey = getSupabasePublishableKey();
  checks.push({
    target: "configuration",
    state: supabaseUrl && supabaseKey ? "healthy" : "down",
    message:
      supabaseUrl && supabaseKey
        ? "Supabase env configured"
        : "Missing Supabase URL or publishable key",
  });

  const dbStart = Date.now();
  const { error: dbErr } = await supabase
    .from("platform_settings")
    .select("id")
    .eq("id", 1)
    .maybeSingle();
  const dbMs = Date.now() - dbStart;
  checks.push({
    target: "database",
    state: latencyState(dbMs, !dbErr),
    message: dbErr ? dbErr.message : `DB ${dbMs}ms`,
  });

  const apiStart = Date.now();
  const { error: apiErr } = await supabase.auth.getUser();
  const apiMs = Date.now() - apiStart;
  checks.push({
    target: "api",
    state: latencyState(apiMs, !apiErr),
    message: apiErr ? apiErr.message : `API ${apiMs}ms`,
  });

  const storageStart = Date.now();
  const { error: storageErr } = await supabase.storage.from("avatars").list("", { limit: 1 });
  const storageMs = Date.now() - storageStart;
  checks.push({
    target: "storage",
    state: latencyState(storageMs, !storageErr),
    message: storageErr ? storageErr.message : `Storage ${storageMs}ms`,
  });

  const healthyCount = checks.filter((c) => c.state === "healthy").length;

  return {
    healthyCount,
    totalChecks: checks.length,
    checks,
    note: "Realtime and in-memory managers (billing plans, feature flags) are not probed server-side.",
  };
}

    note: "Server-side probes only (configuration, database, api, storage). Realtime/queue not probed here.",
  };
}

function buildOperationalIssues(input: {
  health: Awaited<ReturnType<typeof loadHealthSummary>>;
  tenants: {
    companies: Array<{
      name: string;
      status: string;
      branches: Array<{ name: string; isActive: boolean }>;
    }>;
    unassignedRealBranches: Array<{ name: string; code: string | null; isActive: boolean }>;
  };
  branchDirectories: Array<{
    branchName: string;
    companyName: string | null;
    isActive: boolean;
    unassignedEmployeeCount: number;
    unassignedEmployees: string[];
    departmentsDirectory: Array<{ name: string; headName: string | null }>;
  }>;
  ai: Awaited<ReturnType<typeof loadAiSummary>>;
  audit: Awaited<ReturnType<typeof loadAuditSummary>>;
  owners: Awaited<ReturnType<typeof loadPlatformOwnersSummary>>;
}): {
  totalCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  issues: OperationalIssue[];
  note: string;
} {
  const issues: OperationalIssue[] = [];

  for (const check of input.health.checks) {
    if (check.state === "healthy") continue;
    issues.push({
      severity: check.state === "down" ? "critical" : "warning",
      scope: "infrastructure",
      companyName: null,
      branchName: null,
      departmentName: null,
      component: check.target,
      message: check.message,
    });
  }

  if (input.ai.isGloballyEnabled === false) {
    issues.push({
      severity: "warning",
      scope: "platform",
      companyName: null,
      branchName: null,
      departmentName: null,
      component: "ai",
      message: "AI assistant is globally disabled",
    });
  }

  for (const grant of input.ai.grants.companyGrants) {
    if (
      grant.quotaMinutes != null &&
      grant.usedMinutes != null &&
      grant.usedMinutes >= grant.quotaMinutes
    ) {
      issues.push({
        severity: "warning",
        scope: "company",
        companyName: null,
        branchName: null,
        departmentName: null,
        component: "ai_grant",
        message: `Company AI grant exhausted (${grant.usedMinutes}/${grant.quotaMinutes} minutes, scopeId ${grant.scopeId})`,
      });
    }
  }

  for (const company of input.tenants.companies) {
    if (company.status === "suspended") {
      issues.push({
        severity: "critical",
        scope: "company",
        companyName: company.name,
        branchName: null,
        departmentName: null,
        component: "company_status",
        message: "Company is suspended",
      });
    } else if (company.status === "inactive") {
      issues.push({
        severity: "warning",
        scope: "company",
        companyName: company.name,
        branchName: null,
        departmentName: null,
        component: "company_status",
        message: "Company is inactive",
      });
    }

    for (const branch of company.branches) {
      if (!branch.isActive) {
        issues.push({
          severity: "warning",
          scope: "branch",
          companyName: company.name,
          branchName: branch.name,
          departmentName: null,
          component: "branch_assignment",
          message: "Branch assignment is inactive",
        });
      }
    }
  }

  for (const branch of input.tenants.unassignedRealBranches) {
    issues.push({
      severity: "warning",
      scope: "branch",
      companyName: null,
      branchName: branch.name,
      departmentName: null,
      component: "branch_assignment",
      message: "Operational branch is not assigned to any company on the platform",
    });
  }

  for (const branch of input.branchDirectories) {
    if (!branch.companyName) {
      issues.push({
        severity: "warning",
        scope: "branch",
        companyName: null,
        branchName: branch.branchName,
        departmentName: null,
        component: "branch_assignment",
        message: "Branch has no linked company in platform assignments",
      });
    }

    if (!branch.isActive) {
      issues.push({
        severity: "warning",
        scope: "branch",
        companyName: branch.companyName,
        branchName: branch.branchName,
        departmentName: null,
        component: "branch_status",
        message: "Branch is marked inactive",
      });
    }

    if (branch.unassignedEmployeeCount > 0) {
      const sample = branch.unassignedEmployees.slice(0, 3).join(", ");
      issues.push({
        severity: "warning",
        scope: "branch",
        companyName: branch.companyName,
        branchName: branch.branchName,
        departmentName: null,
        component: "employees",
        message: `${branch.unassignedEmployeeCount} active employee(s) without a department${sample ? ` (e.g. ${sample})` : ""}`,
      });
    }

    for (const dept of branch.departmentsDirectory) {
      if (!dept.headName) {
        issues.push({
          severity: "info",
          scope: "department",
          companyName: branch.companyName,
          branchName: branch.branchName,
          departmentName: dept.name,
          component: "department_manager",
          message: "Department has no assigned manager",
        });
      }
    }
  }

  if (input.owners.suspendedCount > 0) {
    issues.push({
      severity: "info",
      scope: "platform",
      companyName: null,
      branchName: null,
      departmentName: null,
      component: "platform_owners",
      message: `${input.owners.suspendedCount} platform owner account(s) suspended`,
    });
  }

  for (const event of input.audit.recent) {
    if (event.event === "owner.suspended" || event.event === "owner.deleted") {
      issues.push({
        severity: "info",
        scope: "platform",
        companyName: null,
        branchName: null,
        departmentName: null,
        component: "audit",
        message: `Recent audit: ${event.eventLabel} at ${event.at}`,
      });
    }
  }

  const severityRank: Record<IssueSeverity, number> = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const infoCount = issues.filter((i) => i.severity === "info").length;

  return {
    totalCount: issues.length,
    criticalCount,
    warningCount,
    infoCount,
    issues: issues.slice(0, 60),
    note: "Auto-detected from health checks, company/branch configuration, departments, employees, AI grants, and audit — not a full application error log.",
  };
}

/** Read-only platform owner snapshot — uses caller session (RLS) only. */
export async function buildPlatformOwnerSnapshot(supabase: Db, userId: string) {
  await assertPlatformOwner(supabase, userId);

  const today = jerusalemTodayIso();

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, first_name, last_name")
    .eq("id", userId)
    .maybeSingle();

  const { data: accessRaw } = await supabase.rpc("get_my_ai_access");
  const callerAiAccess = accessRaw as {
    allowed?: boolean;
    remaining_minutes?: number | null;
    quota_minutes?: number | null;
  } | null;

  const tenantsPromise = loadTenantsSummary(supabase);
  const [owners, tenantsRaw, ai, audit, settings, health, branchDirectories] = await Promise.all([
    loadPlatformOwnersSummary(supabase),
    tenantsPromise,
    loadAiSummary(supabase),
    loadAuditSummary(supabase),
    loadPlatformSettings(supabase),
    loadHealthSummary(supabase),
    tenantsPromise.then((t) => loadBranchOperationalDirectories(supabase, t.branchMeta, today)),
  ]);
  const { branchMeta: _branchMeta, ...tenants } = tenantsRaw;

  const operationalIssues = buildOperationalIssues({
    health,
    tenants,
    branchDirectories,
    ai,
    audit,
    owners,
  });

  return {
    role: "platform_owner",
    asOfDate: today,
    caller: {
      name: profile ? formatEmployeeName(profile) : null,
      aiAccess: {
        allowed: !!callerAiAccess?.allowed,
        remainingMinutes: callerAiAccess?.remaining_minutes ?? null,
        quotaMinutes: callerAiAccess?.quota_minutes ?? null,
      },
    },
    owners,
    tenants,
    branchDirectories,
    ai,
    billing: {
      note: "UI billing plans (free/standard/enterprise) are session-scoped stubs. Company AI grants in ai.grants with billing_plan are the durable billing link for assistant quotas.",
      companyGrantsWithBillingPlan: ai.grants.companyGrants.filter((g) => g.billingPlan).length,
    },
    audit,
    settings,
    health,
    operationalIssues,
  };
}
