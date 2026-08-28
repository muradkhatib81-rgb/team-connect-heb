import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createEmployee, resetEmployeePassword, deleteEmployee, setEmployeeActive, updateEmployee } from "@/lib/employees.functions";
import { extractServerFnErrorMessage } from "@/lib/server-fn-error";
import { translateBillingError } from "@/lib/billing-errors";
import { useTranslation } from "react-i18next";
import { formatLeaveDateRange, isEmployeeCurrentlyOnLeave } from "@/lib/employee-leave";
import { HebrewDateInput } from "@/components/hebrew-datetime";
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
import { useAuth } from "@/lib/use-auth";
import { useJobTitles } from "@/lib/use-job-titles";
import {
  getRoleLabel,
  ROLE_OPTIONS,
  isAdmin,
  isPlatformOwner,
  type AppRole,
} from "@/lib/constants";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";
import { Search, Loader2, Pencil, UserPlus, Filter, ImagePlus, X, KeyRound, Trash2, Users, UserCheck, UserX, Plane, Shield, Power, Download } from "lucide-react";
import { toast } from "sonner";
import { formatEmployeeName, employeeMatchesSearch, employeeNameInitial, splitFullName } from "@/lib/employee-name";
import { isNonEmployeeIdentity } from "@/lib/employee-identity";
import { ContactActions } from "@/components/contact-actions";

type FilterMode = "all" | "active" | "inactive" | "on_leave" | "on_break" | "managers" | "workers";

interface EmployeesSearch {
  filter?: FilterMode;
  dept?: string;
}

const FILTER_VALUES: FilterMode[] = ["all", "active", "inactive", "on_leave", "on_break", "managers", "workers"];

export const Route = createFileRoute("/_authenticated/employees")({
  component: EmployeesPage,
  validateSearch: (s: Record<string, unknown>): EmployeesSearch => ({
    filter: (FILTER_VALUES.includes(s.filter as FilterMode)
      ? (s.filter as FilterMode)
      : undefined),
    dept: typeof s.dept === "string" ? s.dept : undefined,
  }),
});

interface DeptOption {
  id: string;
  name: string;
  code: string;
}

interface ProfileRow {
  id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  id_number: string | null;
  department_id: string | null;
  branch_id: string | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_code?: string | null;
  avatar_url: string | null;
  deactivated_at: string | null;
  excluded_from_headcount?: boolean;
}

function isCountedInHeadcount(e: Pick<ProfileRow, "excluded_from_headcount">) {
  return !e.excluded_from_headcount;
}

function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

/** Org-level managers only — department_manager counts as an employee in filters/stats. */
const ORG_MANAGER_ROLES = new Set<AppRole>([
  "system_admin",
  "main_admin",
  "branch_manager",
  "assistant_manager",
]);

function isOrgManagerRole(roles: string[]) {
  return roles.some((role) => ORG_MANAGER_ROLES.has(role as AppRole));
}

function assignableRoleOptionsFor(
  roles: AppRole[] | undefined,
  canManageRoles = false,
): AppRole[] {
  if (roles?.includes("main_admin")) return ROLE_OPTIONS;
  if (roles?.includes("branch_manager") || canManageRoles) {
    return ROLE_OPTIONS.filter((r) => r !== "main_admin" && r !== "branch_manager");
  }
  return ["employee"];
}



async function uploadAvatar(file: File, userId: string): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("avatars").upload(path, file, {
    upsert: true,
    contentType: file.type || undefined,
  });
  if (error) throw new Error(error.message);
  return path;
}

// Cache signed URLs per path for the lifetime of the page (signed URLs live ~1h)
const signedUrlCache = new Map<string, string>();

function useSignedAvatarUrls(paths: (string | null | undefined)[]) {
  const unique = useMemo(() => {
    const set = new Set<string>();
    paths.forEach((p) => p && !signedUrlCache.has(p) && set.add(p));
    return Array.from(set);
  }, [paths]);

  return useQuery({
    queryKey: ["avatar-signed-urls", unique.sort().join("|")],
    enabled: unique.length > 0,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const results = await Promise.all(
        unique.map(async (p) => {
          const { data } = await supabase.storage.from("avatars").createSignedUrl(p, 60 * 60);
          return [p, data?.signedUrl ?? ""] as const;
        }),
      );
      results.forEach(([p, url]) => url && signedUrlCache.set(p, url));
      return Object.fromEntries(results);
    },
  });
}

function avatarUrlFor(path: string | null | undefined): string | null {
  if (!path) return null;
  return signedUrlCache.get(path) ?? null;
}

function EmployeesPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/_authenticated/employees" });
  const { data: me, isLoading: meLoading } = useAuth();
  const qcPage = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<ProfileRow | null>(null);
  const [deleting, setDeleting] = useState<ProfileRow | null>(null);

  const filterMode: FilterMode = search.filter ?? "active";
  const allowedAdmin = me ? isAdmin(me.roles) : false;
  const isDeptManagerOnly =
    me ? me.roles.includes("department_manager") && !allowedAdmin : false;
  // Department managers are forced to their own department (server RLS also enforces).
  const forcedDept = isDeptManagerOnly ? (me?.department_id ?? "all") : null;
  const deptFilter = forcedDept ?? (search.dept ?? "all");

  const setFilter = (f: FilterMode) =>
    navigate({ to: "/employees", search: { filter: f, dept: deptFilter } as any });
  const setDept = (d: string) =>
    navigate({ to: "/employees", search: { filter: filterMode, dept: d } as any });

  const isDeptManager = me ? me.roles.includes("department_manager") : false;
  const allowed = allowedAdmin || isDeptManager;
  const permissionsQ = useCurrentPermissions(me?.id);
  const canAddEmployee = me
    ? hasBranchActionPermission(me.roles, permissionsQ.data, "can_add_employee")
    : false;
  const canEditEmployee = me
    ? hasBranchActionPermission(me.roles, permissionsQ.data, "can_edit_employee")
    : false;
  const canDeleteEmployee = me
    ? hasBranchActionPermission(me.roles, permissionsQ.data, "can_delete_employee")
    : false;
  const canResetEmployeePassword = me
    ? hasBranchActionPermission(
        me.roles,
        permissionsQ.data,
        "can_reset_employee_password",
      )
    : false;
  const canExportEmployees = me
    ? hasBranchActionPermission(
        me.roles,
        permissionsQ.data,
        "can_export_employees",
      )
    : false;
  const canManageUserRoles = me
    ? hasBranchActionPermission(me.roles, permissionsQ.data, "can_manage_users")
    : false;
  /** Job title (תפקיד) field — platform owners only; hidden for BM / assistant. */
  const canEditJobTitle = me ? isPlatformOwner(me.roles) : false;

  function exportEmployeesCsv() {
    const rows = [
      [
        t("employeesPage.csv.name"),
        t("employeesPage.csv.department"),
        t("employeesPage.csv.jobTitle"),
        t("employeesPage.csv.status"),
        t("employeesPage.csv.idNumber"),
        t("employeesPage.csv.phone"),
      ],
      ...employees.map((employee) => [
        formatEmployeeName(employee),
        employee.department_id ? (deptMap[employee.department_id] ?? "") : "",
        employee.job_title ?? "",
        employee.is_active ? t("employeesPage.csv.active") : t("employeesPage.csv.inactive"),
        employee.id_number ?? "",
        employee.phone ?? "",
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `employees-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  // Reactivation flow — flip is_active back to true and write an audit entry via RPC.
  const setActiveFn = useServerFn(setEmployeeActive);
  const reactivateMutation = useMutation({
    mutationFn: async (userId: string) =>
      setActiveFn({ data: { user_id: userId, is_active: true } }),
    onSuccess: () => {
      toast.success(t("employeesPage.reactivated"));
      qcPage.invalidateQueries({ queryKey: ["employees"] });
      qcPage.invalidateQueries({ queryKey: ["all-roles"] });
      qcPage.invalidateQueries({ queryKey: ["departments"] });
      qcPage.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qcPage.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
    },
    onError: (e: any) => toast.error(e?.message ?? t("employeesPage.reactivateError")),
  });


  const deptsQuery = useQuery({
    enabled: allowed,
    queryKey: ["departments", "options"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, code")
        .order("name");
      if (error) throw error;
      return (data ?? []) as DeptOption[];
    },
  });

  const deptMap = useMemo(() => {
    const map: Record<string, string> = {};
    (deptsQuery.data ?? []).forEach((d) => (map[d.id] = d.name));
    return map;
  }, [deptsQuery.data]);

  // Single source of truth: same profiles query the Dashboard uses.
  // Contact details (id_number, phone) come from a separate RPC and are
  // merged in as optional — a failure there must NOT empty the employees list.
  const employeesQuery = useQuery({
    enabled: allowed,
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name, department_id, branch_id, job_title, is_active, on_leave, leave_start_date, leave_end_date, leave_type_code, avatar_url, deactivated_at, excluded_from_headcount")
        .order("first_name")
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as ProfileRow[];
    },
  });

  const contactsQuery = useQuery({
    enabled: allowed,
    queryKey: ["employees-contacts"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_profiles_contact");
      if (error) {
        // Non-fatal: viewer may lack the perm. Return empty map.
        console.warn("list_profiles_contact failed:", error.message);
        return {} as Record<string, { id_number: string | null; phone: string | null }>;
      }
      const cmap: Record<string, { id_number: string | null; phone: string | null }> = {};
      (data ?? []).forEach((c: any) => {
        cmap[c.id] = { id_number: c.id_number ?? null, phone: c.phone ?? null };
      });
      return cmap;
    },
  });


  const rolesQuery = useQuery({
    enabled: allowed,
    queryKey: ["all-roles"],
    queryFn: async () => {
      // Scoped viewers (assistant manager, dept head) cannot read user_roles
      // directly; this RPC returns roles for the staff they already see.
      const { data, error } = await supabase.rpc("list_visible_user_roles");
      if (error) throw error;
      const map: Record<string, AppRole[]> = {};
      (data ?? []).forEach((r) => {
        map[r.user_id] ||= [];
        map[r.user_id].push(r.role as AppRole);
      });
      return map;
    },
  });

  // Live list of users currently on an active break (IDs, for filtering + count)
  const activeBreaksQ = useQuery({
    enabled: allowed,
    queryKey: ["employees-page-active-breaks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("user_id")
        .eq("status", "active");
      if (error) throw error;
      return Array.from(new Set((data ?? []).map((r: any) => r.user_id as string)));
    },
  });
  const onBreakSet = useMemo(() => new Set(activeBreaksQ.data ?? []), [activeBreaksQ.data]);

  const rolesMap = rolesQuery.data ?? {};
  const isManagerRole = (uid: string) => isOrgManagerRole(rolesMap[uid] ?? []);

  // Merge optional contact details (id_number, phone) into the profiles list.
  const employees: ProfileRow[] = useMemo(() => {
    const list = employeesQuery.data ?? [];
    const cmap = contactsQuery.data ?? {};
    return list
      .filter((p) => !isNonEmployeeIdentity(p))
      .map((p) => ({
        ...p,
        id_number: cmap[p.id]?.id_number ?? null,
        phone: cmap[p.id]?.phone ?? null,
      }));
  }, [employeesQuery.data, contactsQuery.data]);

  const countedEmployees = useMemo(
    () => employees.filter(isCountedInHeadcount),
    [employees],
  );

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return employees.filter((e) => {
      // Hide department manager from their own list — except when viewing who is on leave.
      if (isDeptManagerOnly && e.id === me?.id && filterMode !== "on_leave") return false;
      if (deptFilter !== "all" && e.department_id !== deptFilter) return false;
      if (filterMode === "active" && !e.is_active) return false;
      if (filterMode === "inactive" && e.is_active) return false;
      if (filterMode === "on_leave" && !isEmployeeCurrentlyOnLeave(e)) return false;
      if (filterMode === "on_break" && !onBreakSet.has(e.id)) return false;
      if (filterMode === "managers" && !isManagerRole(e.id)) return false;
      if (filterMode === "workers" && isManagerRole(e.id)) return false;
      if (!term) return true;
      return (
        employeeMatchesSearch(e, term) ||
        (e.id_number ?? "").includes(term) ||
        (e.phone ?? "").includes(term)
      );
    });
  }, [employees, searchTerm, deptFilter, filterMode, isDeptManagerOnly, me?.id, onBreakSet, rolesMap]);



  // Manager's own department stats (excluding the manager themselves)
  const managerDeptStats = useMemo(() => {
    if (!isDeptManagerOnly || !me?.department_id) return null;
    const data = employeesQuery.data ?? [];
    const dept = data.filter(
      (e) =>
        e.department_id === me.department_id &&
        e.id !== me.id &&
        isCountedInHeadcount(e),
    );
    const selfRow = data.find((e) => e.id === me.id);
    const selfOnLeave = selfRow
      ? isEmployeeCurrentlyOnLeave(selfRow)
      : isEmployeeCurrentlyOnLeave(me);
    return {
      total: dept.length,
      active: dept.filter((e) => e.is_active && !isEmployeeCurrentlyOnLeave(e)).length,
      onLeave: dept.filter((e) => isEmployeeCurrentlyOnLeave(e)).length + (selfOnLeave ? 1 : 0),
      inactive: dept.filter((e) => !e.is_active).length,
    };
  }, [employeesQuery.data, isDeptManagerOnly, me]);

  // Ensure manager's own avatar is signed too
  const managerAvatarQ = useSignedAvatarUrls(
    isDeptManagerOnly
      ? [(employeesQuery.data ?? []).find((e) => e.id === me?.id)?.avatar_url]
      : [],
  );
  const managerAvatarMap = managerAvatarQ.data ?? {};

  // Populate signed URL cache for avatars in current list
  const avatarsQ = useSignedAvatarUrls((employeesQuery.data ?? []).map((e) => e.avatar_url));
  const avatarMap = avatarsQ.data ?? {};

  // Top-level summary stats — derived from the SAME merged employees list
  // used by the table below, so every counter and the rendered rows stay in sync.
  const summaryStats = useMemo(() => {
    const roles = rolesQuery.data ?? {};
    // Role-based counts use the full list so managers excluded from headcount
    // (e.g. branch/assistant manager job titles) still appear in the card.
    const managers = employees.filter((e) => isOrgManagerRole(roles[e.id] ?? [])).length;
    let workers = 0;
    let active = 0;
    let onLeave = 0;
    let inactive = 0;
    countedEmployees.forEach((e) => {
      if (!isOrgManagerRole(roles[e.id] ?? [])) workers += 1;
      if (e.is_active && !isEmployeeCurrentlyOnLeave(e)) active += 1;
      if (isEmployeeCurrentlyOnLeave(e)) onLeave += 1;
      if (!e.is_active) inactive += 1;
    });
    return {
      total: countedEmployees.length,
      active,
      managers,
      workers,
      onLeave,
      inactive,
    };
  }, [countedEmployees, employees, rolesQuery.data]);


  if (meLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">{t("employeesPage.noAccessTitle")}</h2>
        <p className="text-sm text-muted-foreground mt-2">{t("employeesPage.noAccessDesc")}</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>{t("common.back")}</Button>
      </Card>
    );
  }

  const headerSubtitle = t("employeesPage.headerSubtitle", {
    shown: filtered.filter(isCountedInHeadcount).length,
    total: countedEmployees.length,
    filter: t(`employeesPage.filters.${filterMode}`),
    deptSuffix:
      deptFilter !== "all" && deptMap[deptFilter] ? ` · ${deptMap[deptFilter]}` : "",
  });

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t("employeesPage.title")}</h1>
          {isDeptManagerOnly && me?.department_id && deptMap[me.department_id] && (
            <p className="text-sm font-medium text-primary mt-1">
              {t("employeesPage.departmentLabel", { name: deptMap[me.department_id] })}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-1">{headerSubtitle}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canExportEmployees && (
            <Button variant="outline" className="gap-2" onClick={exportEmployeesCsv}>
              <Download className="size-4" />
              {t("employeesPage.exportEmployees")}
            </Button>
          )}
          {canAddEmployee && (
            <Button className="gap-2" onClick={() => setCreating(true)}>
              <UserPlus className="size-4" />
              {t("employeesPage.addEmployee")}
            </Button>
          )}
        </div>
      </header>

      {!isDeptManagerOnly && (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <SummaryStatCard label={t("employeesPage.stats.workers")} value={summaryStats.workers} icon={<Users className="size-5" />} tone="primary" emoji="👤" active={filterMode === "workers"} onClick={() => setFilter("workers")} />
          <SummaryStatCard label={t("employeesPage.stats.managers")} value={summaryStats.managers} icon={<Shield className="size-5" />} tone="indigo" emoji="👔" active={filterMode === "managers"} onClick={() => setFilter("managers")} />
          <SummaryStatCard label={t("employeesPage.stats.active")} value={summaryStats.active} icon={<UserCheck className="size-5" />} tone="green" emoji="🟢" active={filterMode === "active"} onClick={() => setFilter("active")} />
          <SummaryStatCard label={t("employeesPage.stats.onLeave")} value={summaryStats.onLeave} icon={<Plane className="size-5" />} tone="sky" emoji="🏖️" active={filterMode === "on_leave"} onClick={() => setFilter("on_leave")} />
          <SummaryStatCard label={t("employeesPage.stats.inactive")} value={summaryStats.inactive} icon={<UserX className="size-5" />} tone="red" emoji="❌" active={filterMode === "inactive"} onClick={() => setFilter("inactive")} />
        </section>


      )}

      {isDeptManagerOnly && me && managerDeptStats && (
        <Card className="card-elevated p-4">
          <div className="flex items-center gap-4">
            <div className="size-16 rounded-full bg-accent overflow-hidden flex items-center justify-center shrink-0 border border-border">
              {(() => {
                const path = (employeesQuery.data ?? []).find((e) => e.id === me.id)?.avatar_url;
                const url = path ? (managerAvatarMap[path] ?? avatarUrlFor(path)) : null;
                return url ? (
                  <img src={url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="text-xl font-semibold text-muted-foreground">
                    {employeeNameInitial(me)}
                  </span>
                );
              })()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">{t("employeesPage.deptHead")}</div>
              <div className="font-semibold truncate">{me.full_name}</div>
              <div className="text-sm text-muted-foreground truncate flex items-center gap-2 flex-wrap">
                <span>
                  {me.department_name ?? (me.department_id ? deptMap[me.department_id] : "")}
                  {me.job_title ? ` · ${me.job_title}` : ""}
                </span>
                {isEmployeeCurrentlyOnLeave(me) && (
                  <Badge variant="secondary" className="rounded-full text-xs">{t("employeesPage.badges.onLeave")}</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Badge variant="secondary">{t("employeesPage.badges.employeesCount", { count: managerDeptStats.total })}</Badge>
              <Badge variant="outline">{t("employeesPage.badges.activeCount", { count: managerDeptStats.active })}</Badge>
              {managerDeptStats.onLeave > 0 && (
                <Badge variant="outline">{t("employeesPage.badges.onLeaveCount", { count: managerDeptStats.onLeave })}</Badge>
              )}
            </div>
          </div>
        </Card>
      )}

      {isDeptManagerOnly && managerDeptStats && (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <SummaryStatCard
            label={t("employeesPage.stats.deptEmployees")}
            value={managerDeptStats.total}
            icon={<Users className="size-5" />}
            tone="primary"
            emoji="👥"
            active={filterMode === "all"}
            onClick={() => setFilter("all")}
          />
          <SummaryStatCard
            label={t("employeesPage.stats.active")}
            value={managerDeptStats.active}
            icon={<UserCheck className="size-5" />}
            tone="green"
            emoji="🟢"
            active={filterMode === "active"}
            onClick={() => setFilter("active")}
          />
          <SummaryStatCard
            label={t("employeesPage.stats.onLeave")}
            value={managerDeptStats.onLeave}
            icon={<Plane className="size-5" />}
            tone="sky"
            emoji="🏖️"
            active={filterMode === "on_leave"}
            onClick={() => setFilter("on_leave")}
          />
          <SummaryStatCard
            label={t("employeesPage.stats.inactive")}
            value={managerDeptStats.inactive}
            icon={<UserX className="size-5" />}
            tone="red"
            emoji="❌"
            active={filterMode === "inactive"}
            onClick={() => setFilter("inactive")}
          />
        </section>
      )}



      <Card className="card-elevated p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder={t("employeesPage.searchPlaceholder")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pr-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select value={filterMode} onValueChange={(v) => setFilter(v as FilterMode)}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">{t("employeesPage.filters.active")}</SelectItem>
                <SelectItem value="inactive">{t("employeesPage.filters.inactive")}</SelectItem>
                <SelectItem value="all">{t("employeesPage.filters.all")}</SelectItem>
                <SelectItem value="managers">{t("employeesPage.filters.managers")}</SelectItem>
                <SelectItem value="workers">{t("employeesPage.filters.workers")}</SelectItem>
                <SelectItem value="on_leave">{t("employeesPage.filters.on_leave")}</SelectItem>
                <SelectItem value="on_break">{t("employeesPage.filters.on_break")}</SelectItem>


              </SelectContent>
            </Select>
            {!isDeptManagerOnly && (
              <Select value={deptFilter} onValueChange={setDept}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("employeesPage.allDepartments")}</SelectItem>
                  {(deptsQuery.data ?? []).map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </Card>

      {employeesQuery.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : employeesQuery.isError ? (
        <Card className="card-elevated p-6 text-center space-y-3">
          <div className="text-destructive font-medium">{t("employeesPage.loadError")}</div>
          <div className="text-sm text-muted-foreground">{(employeesQuery.error as Error)?.message ?? t("employeesPage.loadFailed")}</div>
          <Button variant="outline" onClick={() => employeesQuery.refetch()}>{t("employeesPage.retry")}</Button>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="card-elevated p-10 text-center text-muted-foreground">
          {t("employeesPage.noEmployees")}
        </Card>
      ) : (

        <div className="grid gap-3">
          {filtered.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              deptName={emp.department_id ? deptMap[emp.department_id] : null}
              roles={rolesQuery.data?.[emp.id] ?? []}
              avatarUrl={emp.avatar_url ? (avatarMap[emp.avatar_url] ?? avatarUrlFor(emp.avatar_url)) : null}
              onEdit={() => setEditing(emp)}
              onResetPassword={() => setResetting(emp)}
              onDelete={() => setDeleting(emp)}
              onReactivate={() => reactivateMutation.mutate(emp.id)}
              reactivating={reactivateMutation.isPending && reactivateMutation.variables === emp.id}
              canEdit={canEditEmployee}
              canResetPassword={canResetEmployeePassword}
              canDelete={canDeleteEmployee && emp.id !== me?.id}
              canReactivate={canEditEmployee}
            />
          ))}

        </div>
      )}

      {resetting && canResetEmployeePassword && (
        <ResetPasswordDialog employee={resetting} onClose={() => setResetting(null)} />
      )}

      {deleting && canDeleteEmployee && (
        <DeleteEmployeeDialog employee={deleting} onClose={() => setDeleting(null)} />
      )}

      {editing && me && canEditEmployee && (
        <EditEmployeeDialog
          employee={editing}
          depts={deptsQuery.data ?? []}
          currentRoles={rolesQuery.data?.[editing.id] ?? []}
          canEditRoles={canManageUserRoles}
          canEditJobTitle={canEditJobTitle}
          canDelete={canDeleteEmployee && editing.id !== me.id}
          currentUserRoles={me.roles}
          onDelete={() => {
            setDeleting(editing);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && canAddEmployee && (
        <CreateEmployeeDialog
          depts={deptsQuery.data ?? []}
          onClose={() => setCreating(false)}
          onEditExisting={(id) => {
            const emp = (employeesQuery.data ?? []).find((e) => e.id === id);
            if (emp) {
              setCreating(false);
              setEditing(emp);
            }
          }}
          onViewExisting={(idNumber) => {
            setCreating(false);
            setSearchTerm(idNumber);
            setFilter("all");
          }}
          currentUserRoles={me?.roles}
          canManageRoles={canManageUserRoles}
          canEditJobTitle={canEditJobTitle}
        />
      )}
    </div>
  );
}

function AvatarPicker({
  initialUrl,
  onFileSelected,
  onCleared,
}: {
  initialUrl: string | null;
  onFileSelected: (file: File) => void;
  onCleared?: () => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="size-16 rounded-full bg-accent overflow-hidden flex items-center justify-center shrink-0 border border-border">
        {preview ? (
          <img src={preview} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {preview ? t("employeesPage.changePhoto") : t("employeesPage.uploadPhoto")}
        </Button>
        {preview && onCleared && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPreview(null);
              onCleared();
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          if (f.size > 5 * 1024 * 1024) {
            toast.error(t("employeesPage.fileTooLarge"));
            return;
          }
          setPreview(URL.createObjectURL(f));
          onFileSelected(f);
        }}
      />
    </div>
  );
}

export function CreateEmployeeDialog({
  depts,
  onClose,
  onEditExisting,
  onViewExisting,
  defaultDepartmentId,
  lockDepartment,
  currentUserRoles,
  canManageRoles,
  canEditJobTitle = false,
}: {
  depts: DeptOption[];
  onClose: () => void;
  onEditExisting?: (id: string) => void;
  onViewExisting?: (idNumber: string) => void;
  defaultDepartmentId?: string;
  lockDepartment?: boolean;
  currentUserRoles?: AppRole[];
  canManageRoles?: boolean;
  canEditJobTitle?: boolean;
}) {
  const qc = useQueryClient();
  const { t } = useTranslation();
  const createFn = useServerFn(createEmployee);
  const jobTitlesQ = useJobTitles();
  const roleOptions = assignableRoleOptionsFor(currentUserRoles, canManageRoles);
  const defaultDept = defaultDepartmentId ?? depts[0]?.id ?? "";
  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    id_number: "",
    department_id: defaultDept,
    phone: "",
    password: "",
    role: (roleOptions.includes("employee") ? "employee" : roleOptions[0] ?? "employee") as AppRole,
    job_title: "",
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  // When the server reports the id_number already belongs to an existing employee
  // (active or inactive) we surface a rich dialog with details and contextual actions.
  type DuplicateInfo = {
    id: string;
    name: string;
    job_title: string;
    department_id: string | null;
    department_name: string | null;
    is_active: boolean;
    on_leave: boolean;
  };
  const [duplicate, setDuplicate] = useState<DuplicateInfo | null>(null);
  type ArchivedInfo = {
    id: string;
    first_name?: string | null;
    last_name?: string | null;
    full_name: string;
    job_title: string | null;
    department_id?: string | null;
    department_name: string | null;
    phone?: string | null;
    archived_at: string;
    deactivated_at: string | null;
    snapshot?: any;
  };
  const [archived, setArchived] = useState<ArchivedInfo | null>(null);
  const [viewingArchive, setViewingArchive] = useState<ArchivedInfo | null>(null);

  const setActiveFn = useServerFn(setEmployeeActive);

  const runCreate = async (forceArchived: boolean) => {
    if (!form.department_id) throw new Error(t("employeesPage.validation.selectDepartment"));
    if (!/^\d{5,15}$/.test(form.id_number)) throw new Error(t("employeesPage.validation.idNumberDigits"));
    if (form.password.length < 6) throw new Error(t("employeesPage.validation.passwordMin6"));
    if (!form.first_name.trim()) throw new Error(t("employeesPage.validation.firstNameRequired"));
    if (!form.last_name.trim()) throw new Error(t("employeesPage.validation.lastNameRequired"));
    const res = await createFn({
      data: { ...form, job_title: form.job_title || "", avatar_url: null, force_archived: forceArchived },
    });
    if (avatarFile && res?.id) {
      try {
        const path = await uploadAvatar(avatarFile, res.id);
        await supabase.from("profiles").update({ avatar_url: path }).eq("id", res.id);
      } catch (e: any) {
        toast.error(t("employeesPage.avatarUploadFailed", { message: e?.message ?? "" }));
      }
    }
  };

  const mutation = useMutation({
    mutationFn: () => runCreate(false),
    onSuccess: () => {
      toast.success(t("employeesPage.createSuccess"));
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
      onClose();
    },
    onError: (e: any) => {
      const msg = extractServerFnErrorMessage(e, t("employeesPage.createError"));
      const idx = msg.indexOf("DUPLICATE_EMPLOYEE::");
      if (idx >= 0) {
        try {
          const parsed = JSON.parse(msg.slice(idx + "DUPLICATE_EMPLOYEE::".length));
          setDuplicate(parsed as DuplicateInfo);
          return;
        } catch {
          // fall through to toast
        }
      }
      const aidx = msg.indexOf("ARCHIVED_EXISTS::");
      if (aidx >= 0) {
        try {
          const parsed = JSON.parse(msg.slice(aidx + "ARCHIVED_EXISTS::".length));
          setArchived(parsed as ArchivedInfo);
          return;
        } catch {
          // fall through to toast
        }
      }
      // Backwards compatibility with the previous error format
      const m = msg.match(/INACTIVE_EXISTS::([0-9a-f-]+)::(.*)$/);
      if (m) {
        setDuplicate({
          id: m[1],
          name: m[2] || t("employeesPage.defaultEmployeeName"),
          job_title: "",
          department_id: null,
          department_name: null,
          is_active: false,
          on_leave: false,
        });
        return;
      }
      toast.error(translateBillingError(msg, t));
    },
  });

  const forceCreateMutation = useMutation({
    mutationFn: () => runCreate(true),
    onSuccess: () => {
      toast.success(t("employeesPage.createSuccessShort"));
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
      setArchived(null);
      onClose();
    },
    onError: (e: any) =>
      toast.error(translateBillingError(extractServerFnErrorMessage(e, t("employeesPage.createError")), t)),
  });


  const reactivateMutation = useMutation({
    mutationFn: async (userId: string) =>
      setActiveFn({ data: { user_id: userId, is_active: true } }),
    onSuccess: () => {
      toast.success(t("employeesPage.reactivated"));
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
      setDuplicate(null);
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("employeesPage.reactivateError")),
  });


  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("employeesPage.create.title")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
          autoComplete="off"
        >
          {/* Honeypot fields to defeat browser autofill of admin credentials */}
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} />

          <Field label={t("employeesPage.fields.profilePhotoOptional")}>
            <AvatarPicker
              initialUrl={null}
              onFileSelected={setAvatarFile}
              onCleared={() => setAvatarFile(null)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={t("employeesPage.fields.firstName")}>
              <Input
                value={form.first_name}
                onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                required
                maxLength={50}
                autoComplete="off"
                name="emp_first_name"
              />
            </Field>
            <Field label={t("employeesPage.fields.lastName")}>
              <Input
                value={form.last_name}
                onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                required
                maxLength={50}
                autoComplete="off"
                name="emp_last_name"
              />
            </Field>
            <Field label={t("employeesPage.fields.idNumber")}>
              <Input
                value={form.id_number}
                onChange={(e) => setForm({ ...form, id_number: e.target.value })}
                required
                dir="ltr"
                inputMode="numeric"
                pattern="\d*"
                maxLength={15}
                autoComplete="off"
                name="emp_id_number"
              />
            </Field>
            <Field label={t("employeesPage.fields.department")}>
              <Select
                value={form.department_id}
                onValueChange={(v) => setForm({ ...form, department_id: v })}
                disabled={!!lockDepartment}
              >
                <SelectTrigger><SelectValue placeholder={t("employeesPage.fields.selectDepartment")} /></SelectTrigger>
                <SelectContent>
                  {depts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("employeesPage.fields.phone")}>
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
                maxLength={20}
                autoComplete="off"
                name="emp_phone_new"
              />
            </Field>
            <Field label={t("employeesPage.fields.permission")}>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roleOptions.map((r) => (
                    <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {canEditJobTitle && (
              <Field label={t("employeesPage.fields.jobTitle")}>
                <Select value={form.job_title || "__none__"} onValueChange={(v) => setForm({ ...form, job_title: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder={t("employeesPage.fields.noJobTitle")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("employeesPage.fields.noJobTitle")}</SelectItem>
                    {(jobTitlesQ.data ?? []).map((jt) => (
                      <SelectItem key={jt.id} value={jt.name}>
                        {jt.name}{jt.excluded_from_headcount ? t("employeesPage.fields.excludedFromHeadcount") : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t("employeesPage.fields.initialPassword")}>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={6}
                dir="ltr"
                autoComplete="new-password"
                name="emp_new_password"
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("employeesPage.create.passwordHint")}
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.create.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      {duplicate && (
        <AlertDialog open onOpenChange={(o) => !o && setDuplicate(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                ⚠️ {duplicate.is_active ? t("employeesPage.duplicate.activeTitle") : t("employeesPage.duplicate.inactiveTitle")}
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-right">
                  <p className="text-sm text-muted-foreground">
                    {duplicate.is_active
                      ? t("employeesPage.duplicate.activeDesc")
                      : t("employeesPage.duplicate.inactiveDesc")}
                  </p>
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                    <div>👤 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelName")}</span> <strong>{duplicate.name || "—"}</strong></div>
                    <div>💼 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelJobTitle")}</span> <strong>{duplicate.job_title || "—"}</strong></div>
                    <div>🏬 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelDepartment")}</span> <strong>{duplicate.department_name || "—"}</strong></div>
                    <div>
                      📌 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelStatus")}</span>{" "}
                      {duplicate.is_active ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-green-600">🟢 {t("employeesPage.badges.active")}{duplicate.on_leave ? t("employeesPage.badges.activeOnLeave") : ""}</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 font-semibold text-red-600">🔴 {t("employeesPage.badges.inactive")}</span>
                      )}
                    </div>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <AlertDialogCancel disabled={reactivateMutation.isPending}>{t("employeesPage.duplicate.cancel")}</AlertDialogCancel>
              {duplicate.is_active && onViewExisting && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onViewExisting(form.id_number);
                    setDuplicate(null);
                  }}
                >
                  {t("employeesPage.duplicate.viewCard")}
                </Button>
              )}
              {onEditExisting && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onEditExisting(duplicate.id);
                    setDuplicate(null);
                  }}
                >
                  {t("employeesPage.duplicate.editDetails")}
                </Button>
              )}
              {!duplicate.is_active && (
                <AlertDialogAction
                  disabled={reactivateMutation.isPending}
                  onClick={(e) => {
                    e.preventDefault();
                    reactivateMutation.mutate(duplicate.id);
                  }}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  {reactivateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.duplicate.reactivate")}
                </AlertDialogAction>
              )}
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {archived && (
        <AlertDialog open onOpenChange={(o) => !o && setArchived(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("employeesPage.archived.title")}</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3 text-right">
                  <p className="text-sm text-muted-foreground">
                    {t("employeesPage.archived.desc")}
                  </p>
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-sm space-y-1.5">
                    <div>👤 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelName")}</span> <strong>{formatEmployeeName(archived)}</strong></div>
                    <div>💼 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelJobTitle")}</span> <strong>{archived.job_title || "—"}</strong></div>
                    <div>🏬 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelDepartment")}</span> <strong>{archived.department_name || "—"}</strong></div>
                    <div>📁 <span className="text-muted-foreground">{t("employeesPage.archived.archivedAt")}</span> <strong>{new Date(archived.archived_at).toLocaleString("he-IL")}</strong></div>
                  </div>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <AlertDialogCancel disabled={forceCreateMutation.isPending}>{t("employeesPage.duplicate.cancel")}</AlertDialogCancel>
              <Button
                type="button"
                variant="outline"
                onClick={() => setViewingArchive(archived)}
              >
                {t("employeesPage.archived.viewArchive")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={forceCreateMutation.isPending}
                onClick={() => {
                  // Restore: pre-fill the form from the archived snapshot so the
                  // re-created profile carries the same name, job title, department
                  // and phone. id_number stays the same. The archive row is kept
                  // as historical record of the previous employment period.
                  const snap = archived.snapshot ?? {};
                  const archivedNames = splitFullName(archived.full_name || snap.full_name || "");
                  setForm((f) => ({
                    ...f,
                    first_name: archived.first_name || snap.first_name || archivedNames.first_name || f.first_name,
                    last_name: archived.last_name || snap.last_name || archivedNames.last_name || f.last_name,
                    department_id: archived.department_id || snap.department_id || f.department_id,
                    phone: archived.phone || snap.phone || "",
                  }));
                  setArchived(null);
                  setTimeout(() => forceCreateMutation.mutate(), 0);
                }}
              >
                {t("employeesPage.archived.restore")}
              </Button>
              <AlertDialogAction
                disabled={forceCreateMutation.isPending}
                onClick={(e) => {
                  e.preventDefault();
                  // Open a new employment period — keep the form as-is, force past
                  // the archive guard. Archive row is preserved.
                  forceCreateMutation.mutate();
                }}
              >
                {forceCreateMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.archived.newEmployment")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {viewingArchive && (
        <Dialog open onOpenChange={(o) => !o && setViewingArchive(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("employeesPage.archived.archiveViewTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 text-sm">
              <div>👤 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelName")}</span> <strong>{formatEmployeeName(viewingArchive)}</strong></div>
              <div>💼 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelJobTitle")}</span> <strong>{viewingArchive.job_title || "—"}</strong></div>
              <div>🏬 <span className="text-muted-foreground">{t("employeesPage.duplicate.labelDepartment")}</span> <strong>{viewingArchive.department_name || "—"}</strong></div>
              {viewingArchive.deactivated_at && (
                <div>🔴 <span className="text-muted-foreground">{t("employeesPage.archived.deactivatedAt")}</span> <strong>{new Date(viewingArchive.deactivated_at).toLocaleString("he-IL")}</strong></div>
              )}
              <div>📁 <span className="text-muted-foreground">{t("employeesPage.archived.archivedAt")}</span> <strong>{new Date(viewingArchive.archived_at).toLocaleString("he-IL")}</strong></div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setViewingArchive(null)}>{t("common.close")}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}


function EmployeeRow({
  emp,
  deptName,
  roles,
  avatarUrl,
  onEdit,
  onResetPassword,
  onDelete,
  onReactivate,
  reactivating,
  canEdit,
  canResetPassword,
  canDelete,
  canReactivate,
}: {
  emp: ProfileRow;
  deptName: string | null;
  roles: AppRole[];
  avatarUrl: string | null;
  onEdit: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
  onReactivate: () => void;
  reactivating: boolean;
  canEdit: boolean;
  canResetPassword: boolean;
  canDelete: boolean;
  canReactivate: boolean;
}) {
  const { t } = useTranslation();
  // Main admin override: final deletion is available immediately for any employee except self.
  const canFinalDelete = canDelete;

  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center gap-4">
        <div className="size-12 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-base font-semibold shrink-0 overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>{employeeNameInitial(emp)}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap min-w-0">
            <p className="font-semibold truncate">
              {formatEmployeeName(emp)}
              <span className="text-muted-foreground font-normal mx-1.5">·</span>
              <span className="font-medium">{deptName ?? t("employeesPage.noDepartment")}</span>
            </p>
            {!emp.is_active && <Badge variant="destructive" className="rounded-full text-xs">{t("employeesPage.badges.inactive")}</Badge>}
            {isEmployeeCurrentlyOnLeave(emp) && <Badge variant="secondary" className="rounded-full text-xs">{t("employeesPage.badges.onLeave")}</Badge>}
          </div>
          {isEmployeeCurrentlyOnLeave(emp) && formatLeaveDateRange(emp.leave_start_date, emp.leave_end_date) && (
            <p className="text-xs text-muted-foreground mt-0.5">
              {formatLeaveDateRange(emp.leave_start_date, emp.leave_end_date)}
            </p>
          )}
          {emp.phone && (
            <div className="flex items-center gap-2 mt-0.5 min-w-0">
              <p className="text-xs text-muted-foreground truncate" dir="ltr">{emp.phone}</p>
              <ContactActions phone={emp.phone} size="icon" />
            </div>
          )}
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {roles.map((r) => (
                <Badge key={r} variant="secondary" className="rounded-full text-xs">{getRoleLabel(r)}</Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {canReactivate && !emp.is_active && (
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 bg-green-600 hover:bg-green-700 text-white"
              onClick={onReactivate}
              disabled={reactivating}
              aria-label={t("employeesPage.row.reactivateAria")}
            >
              {reactivating ? <Loader2 className="size-4 animate-spin" /> : <Power className="size-4" />}
              <span className="hidden sm:inline">{t("employeesPage.row.reactivate")}</span>
            </Button>
          )}
          {canResetPassword && (

            <Button variant="ghost" size="sm" className="gap-1.5" onClick={onResetPassword} aria-label={t("employeesPage.row.resetPasswordAria")}>
              <KeyRound className="size-4" />
              <span className="hidden sm:inline">{t("employeesPage.row.resetPassword")}</span>
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("employeesPage.row.editAria")}>
              <Pencil className="size-4" />
            </Button>
          )}
          {canFinalDelete && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete} aria-label={t("employeesPage.row.deleteAria")}>
              <Trash2 className="size-4" />
              <span>{t("employeesPage.row.fullDelete")}</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}


function DeleteEmployeeDialog({ employee, onClose }: { employee: ProfileRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteEmployee);
  const mutation = useMutation({
    mutationFn: async () => {
      await deleteFn({ data: { user_id: employee.id } });
    },
    onSuccess: () => {
      toast.success(t("employeesPage.deleted"));
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("employeesPage.deleteError")),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("employeesPage.delete.title", { name: formatEmployeeName(employee) })}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-right">
              <p>
                {t("employeesPage.delete.confirm")}
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.delete.submit")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}


function ResetPasswordDialog({ employee, onClose }: { employee: ProfileRow; onClose: () => void }) {
  const { t } = useTranslation();
  const resetFn = useServerFn(resetEmployeePassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (password.length < 6) throw new Error(t("employeesPage.validation.passwordMin6Reset"));
      if (password !== confirm) throw new Error(t("employeesPage.validation.passwordsMismatch"));
      await resetFn({ data: { user_id: employee.id, password } });
    },
    onSuccess: () => {
      toast.success(t("employeesPage.resetPasswordSuccess"));
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("employeesPage.resetPasswordError")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("employeesPage.resetPassword.title", { name: formatEmployeeName(employee) })}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
          autoComplete="off"
        >
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} />

          <Field label={t("employeesPage.fields.newPassword")}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              dir="ltr"
              autoComplete="new-password"
              name="reset_new_password"
            />
          </Field>
          <Field label={t("employeesPage.fields.confirmPassword")}>
            <Input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={6}
              dir="ltr"
              autoComplete="new-password"
              name="reset_confirm_password"
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            {t("employeesPage.resetPassword.hint")}
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.resetPassword.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditEmployeeDialog({
  employee,
  depts,
  currentRoles,
  canEditRoles,
  canEditJobTitle = false,
  canDelete,
  onDelete,
  onClose,
  currentUserRoles,
}: {
  employee: ProfileRow;
  depts: DeptOption[];
  currentRoles: AppRole[];
  canEditRoles: boolean;
  canEditJobTitle?: boolean;
  canDelete: boolean;
  onDelete: () => void;
  onClose: () => void;
  currentUserRoles?: AppRole[];
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const updateFn = useServerFn(updateEmployee);
  const jobTitlesQ = useJobTitles();
  const roleOptions = assignableRoleOptionsFor(currentUserRoles);
  const initialNames = employee.first_name || employee.last_name
    ? { first_name: employee.first_name, last_name: employee.last_name }
    : splitFullName(employee.full_name);
  const [form, setForm] = useState({
    first_name: initialNames.first_name,
    last_name: initialNames.last_name,
    id_number: employee.id_number ?? "",
    department_id: employee.department_id ?? "",
    phone: employee.phone ?? "",
    is_active: employee.is_active,
    on_leave: employee.on_leave,
    leave_start_date: employee.leave_start_date?.slice(0, 10) ?? "",
    leave_end_date: employee.leave_end_date?.slice(0, 10) ?? "",
    leave_type_code: (employee.leave_type_code as "regular" | "sick" | "") || "regular",
    role: (currentRoles[0] ?? "employee") as AppRole,
    avatar_url: employee.avatar_url,
    job_title: employee.job_title ?? "",
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error(t("employeesPage.validation.selectDepartment"));
      const selected = depts.find((d) => d.id === form.department_id);
      if (!selected) throw new Error(t("employeesPage.validation.departmentNotFound"));
      if (form.on_leave && (!form.leave_start_date || !form.leave_end_date)) {
        throw new Error(t("employeesPage.validation.leaveDatesRequired"));
      }
      if (form.on_leave && !form.leave_type_code) {
        throw new Error(t("employeesPage.validation.leaveTypeRequired"));
      }
      if (
        form.on_leave &&
        form.leave_end_date &&
        form.leave_start_date &&
        form.leave_end_date < form.leave_start_date
      ) {
        throw new Error(t("employeesPage.validation.leaveEndAfterStart"));
      }

      let avatar_url: string | null = form.avatar_url;
      if (removeAvatar) avatar_url = null;
      if (avatarFile) {
        avatar_url = await uploadAvatar(avatarFile, employee.id);
      }

      const isActiveChanged = form.is_active !== employee.is_active;

      await updateFn({
        data: {
          user_id: employee.id,
          first_name: form.first_name,
          last_name: form.last_name,
          id_number: form.id_number || null,
          department_id: form.department_id,
          phone: form.phone || "",
          on_leave: form.on_leave,
          leave_start_date: form.on_leave ? form.leave_start_date : null,
          leave_end_date: form.on_leave ? form.leave_end_date : null,
          leave_type_code: form.on_leave
            ? (form.leave_type_code as "regular" | "sick")
            : null,
          job_title: form.job_title || "",
          is_active: form.is_active,
          is_active_changed: isActiveChanged,
          avatar_url,
          role: form.role,
          role_changed: canEditRoles && form.role !== (currentRoles[0] ?? "employee"),
        },
      });
    },
    onSuccess: () => {
      toast.success(t("employeesPage.updated"));
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "dept-manager"] });
      qc.invalidateQueries({ queryKey: ["dashboard-dept-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-dept-daily-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
      qc.invalidateQueries({ queryKey: ["dept-employees"] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      onClose();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? t("employeesPage.updateError"));
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-md:top-4 max-md:translate-y-0 overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>{t("employeesPage.edit.title")}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4 min-w-0"
          autoComplete="off"
        >
          <Field label={t("employeesPage.fields.profilePhoto")}>
            <AvatarPicker
              initialUrl={avatarUrlFor(form.avatar_url)}
              onFileSelected={(f) => {
                setAvatarFile(f);
                setRemoveAvatar(false);
              }}
              onCleared={() => {
                setAvatarFile(null);
                setRemoveAvatar(true);
              }}
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
            <Field label={t("employeesPage.fields.firstName")}>
              <Input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required autoComplete="off" maxLength={50} />
            </Field>
            <Field label={t("employeesPage.fields.lastName")}>
              <Input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required autoComplete="off" maxLength={50} />
            </Field>
            <Field label={t("employeesPage.fields.idNumber")}>
              <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} dir="ltr" autoComplete="off" />
            </Field>
            <Field label={t("employeesPage.fields.phone")}>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" autoComplete="off" />
              <ContactActions phone={form.phone} className="mt-2" />
            </Field>
            <Field label={t("employeesPage.fields.department")}>
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder={t("employeesPage.fields.selectDepartment")} /></SelectTrigger>
                <SelectContent>
                  {depts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {canEditJobTitle && (
              <Field label={t("employeesPage.fields.jobTitle")}>
                <Select value={form.job_title || "__none__"} onValueChange={(v) => setForm({ ...form, job_title: v === "__none__" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder={t("employeesPage.fields.noJobTitle")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("employeesPage.fields.noJobTitle")}</SelectItem>
                    {(jobTitlesQ.data ?? []).map((jt) => (
                      <SelectItem key={jt.id} value={jt.name}>
                        {jt.name}{jt.excluded_from_headcount ? t("employeesPage.fields.excludedFromHeadcount") : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {canEditRoles && (
              <Field label={t("employeesPage.fields.permission")}>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((r) => (
                      <SelectItem key={r} value={r}>{getRoleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{t("employeesPage.fields.status")}</p>
              <p className="text-xs text-muted-foreground">
                {form.is_active ? t("employeesPage.status.activeInSystem") : t("employeesPage.status.inactiveInSystem")}
              </p>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{t("employeesPage.fields.onLeave")}</p>
              <p className="text-xs text-muted-foreground">
                {form.on_leave ? t("employeesPage.status.onLeaveNow") : t("employeesPage.status.notOnLeave")}
              </p>
            </div>
            <Switch
              checked={form.on_leave}
              onCheckedChange={(v) =>
                setForm({
                  ...form,
                  on_leave: v,
                  ...(v
                    ? { leave_type_code: form.leave_type_code || "regular" }
                    : { leave_start_date: "", leave_end_date: "", leave_type_code: "regular" }),
                })
              }
            />
          </div>

          {form.on_leave && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-border p-3">
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("employeesPage.fields.leaveType")}</Label>
                <Select
                  value={form.leave_type_code || "regular"}
                  onValueChange={(v) =>
                    setForm({ ...form, leave_type_code: v as "regular" | "sick" })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("employeesPage.fields.selectLeaveType")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="regular">{t("employeesPage.leaveTypes.regular")}</SelectItem>
                    <SelectItem value="sick">{t("employeesPage.leaveTypes.sick")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave_start">{t("employeesPage.fields.leaveStart")}</Label>
                <HebrewDateInput
                  value={form.leave_start_date}
                  onChange={(v) => setForm({ ...form, leave_start_date: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="leave_end">{t("employeesPage.fields.leaveEnd")}</Label>
                <HebrewDateInput
                  value={form.leave_end_date}
                  min={form.leave_start_date || undefined}
                  onChange={(v) => setForm({ ...form, leave_end_date: v })}
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {t("employeesPage.edit.leaveScheduleHint")}
              </p>
            </div>
          )}

          <DialogFooter className="gap-2 sm:flex-col-reverse md:flex-row md:justify-between">
            {canDelete ? (
              <Button
                type="button"
                variant="destructive"
                className="gap-1.5"
                onClick={onDelete}
                disabled={mutation.isPending}
              >
                <Trash2 className="size-4" />
                {t("employeesPage.edit.deleteEmployee")}
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("employeesPage.edit.save")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function SummaryStatCard({
  label,
  value,
  icon,
  tone,
  emoji,
  active,
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "primary" | "green" | "red" | "sky" | "amber" | "indigo";
  emoji: string;
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };
  const inner = (
    <div className="flex items-center gap-3">
      <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
        {icon}
      </div>
      <div className="min-w-0 text-right">
        <p className="text-xs text-muted-foreground truncate">
          <span className="me-1">{emoji}</span>
          {label}
        </p>
        <p className="text-xl font-bold leading-tight">{value}</p>
      </div>
    </div>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`text-right transition-all ${active ? "ring-2 ring-primary" : "hover:bg-accent/40"} rounded-xl`}
        aria-pressed={active}
      >
        <Card className="card-elevated p-3">{inner}</Card>
      </button>
    );
  }
  return <Card className="card-elevated p-3">{inner}</Card>;
}
