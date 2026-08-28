import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { ROLE_LABELS, isPlatformOwner, type AppRole } from "@/lib/constants";
import {
  hasBranchActionPermission,
  useCurrentPermissions,
} from "@/lib/use-current-permissions";
import {
  formatLeaveDateRange,
  isEmployeeCurrentlyOnLeave,
} from "@/lib/employee-leave";
import {
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from "@/lib/departments.functions";
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
import {
  Dialog,
  DialogContent,
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
import { Switch } from "@/components/ui/switch";
import { Loader2, Building2, Plus, Pencil, Trash2, User, UserPlus, Crown } from "lucide-react";
import { toast } from "sonner";
import { formatEmployeeName } from "@/lib/employee-name";
import { CreateEmployeeDialog } from "@/routes/_authenticated/employees";
import { ProfilePhoneField } from "@/components/contact-actions";
import i18n from "@/i18n";

export const Route = createFileRoute("/_authenticated/departments")({
  component: DepartmentsPage,
});

interface ManagerOption {
  id: string;
  first_name?: string;
  last_name?: string;
  full_name: string;
}

interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  manager_id: string | null;
  is_active: boolean;
  manager?: ManagerOption | null;
}

async function fetchDepartmentsWithManagers(): Promise<DepartmentRow[]> {
  const { data: depts, error } = await supabase
    .from("departments")
    .select("id, name, code, manager_id, is_active")
    .order("name");
  if (error) throw error;
  const rows = (depts ?? []) as DepartmentRow[];

  const managerIds = [...new Set(rows.map((d) => d.manager_id).filter(Boolean))] as string[];

  const [{ data: managersById }, { data: roleRows }] = await Promise.all([
    managerIds.length
      ? supabase
          .from("profiles")
          .select("id, first_name, last_name, full_name")
          .in("id", managerIds)
      : Promise.resolve({ data: [] as ManagerOption[] }),
    supabase.from("user_roles").select("user_id").eq("role", "department_manager"),
  ]);

  const managerById = new Map((managersById ?? []).map((m) => [m.id, m as ManagerOption]));

  const roleUserIds = (roleRows ?? []).map((r) => r.user_id);
  const managerByDeptId = new Map<string, ManagerOption>();
  if (roleUserIds.length) {
    const { data: roleProfiles, error: roleProfilesErr } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, full_name, department_id")
      .in("id", roleUserIds)
      .not("department_id", "is", null);
    if (roleProfilesErr) throw roleProfilesErr;
    (roleProfiles ?? []).forEach((p: any) => {
      if (p.department_id && !managerByDeptId.has(p.department_id)) {
        managerByDeptId.set(p.department_id, p as ManagerOption);
      }
    });
  }

  return rows.map((d) => ({
    ...d,
    manager:
      (d.manager_id ? managerById.get(d.manager_id) : null) ??
      managerByDeptId.get(d.id) ??
      null,
  }));
}

function DepartmentsPage() {
  const { t } = useTranslation();
  const { data: me, isLoading: meLoading } = useAuth();
  const permissionsQ = useCurrentPermissions(me?.id);
  const canManageDepartments = me
    ? hasBranchActionPermission(
        me.roles,
        permissionsQ.data,
        "can_manage_departments",
      )
    : false;
  const qcRT = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);
  const [deptDialogId, setDeptDialogId] = useState<string | null>(null);
  const [empDialogId, setEmpDialogId] = useState<string | null>(null);

  const deptsQuery = useQuery({
    enabled: !!me,
    queryKey: ["departments", "list"],
    queryFn: fetchDepartmentsWithManagers,
  });

  const countsQuery = useQuery({
    enabled: !!me,
    queryKey: ["departments", "counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("department_id, is_active");
      if (error) throw error;
      const counts: Record<string, { total: number; active: number }> = {};
      (data ?? []).forEach((r: any) => {
        if (!r.department_id) return;
        counts[r.department_id] ||= { total: 0, active: 0 };
        counts[r.department_id].total += 1;
        if (r.is_active) counts[r.department_id].active += 1;
      });
      return counts;
    },
  });

  const managersQuery = useQuery({
    enabled: !!me && canManageDepartments,
    queryKey: ["managers-pool"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name")
        .eq("is_active", true)
        .order("first_name")
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as ManagerOption[];
    },
  });

  if (meLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me) {
    return null;
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{t("departmentsPage.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("departmentsPage.subtitle")}
          </p>
        </div>
        {canManageDepartments && (
          <Button className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            {t("departmentsPage.addDepartment")}
          </Button>
        )}
      </header>

      {deptsQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(deptsQuery.data ?? []).map((d) => {
            const c = countsQuery.data?.[d.id] ?? { total: 0, active: 0 };
            return (
              <Card
                key={d.id}
                className="card-elevated p-5 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setDeptDialogId(d.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-bold leading-tight truncate">{d.name}</h2>
                    <p className="mt-1.5 leading-tight">
                      <span className="text-xs text-muted-foreground">{t("departmentsPage.departmentManagerLabel")} </span>
                      <span className="text-base sm:text-lg font-bold">
                        {d.manager ? formatEmployeeName(d.manager) : t("departmentsPage.notDefined")}
                      </span>
                    </p>
                  </div>
                  <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Building2 className="size-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <Stat label={t("departmentsPage.totalEmployees")} value={c.total} />
                </div>
                <div className="flex items-center justify-between mt-4">
                  {!d.is_active && (
                    <Badge variant="destructive" className="rounded-full">{t("departmentsPage.inactiveDepartment")}</Badge>
                  )}
                  {canManageDepartments && (
                    <div className="flex gap-1 mr-auto">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(d);
                        }}
                        aria-label={t("common.edit")}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleting(d);
                        }}
                        aria-label={t("common.delete")}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {creating && canManageDepartments && (
        <CreateDialog managers={managersQuery.data ?? []} onClose={() => setCreating(false)} />
      )}
      {editing && canManageDepartments && (
        <EditDialog
          dept={editing}
          onClose={() => setEditing(null)}
        />
      )}

      {deleting && canManageDepartments && (
        <DeleteDialog dept={deleting} onClose={() => setDeleting(null)} />
      )}

      <DeptEmployeesDialog
        deptId={deptDialogId}
        onClose={() => setDeptDialogId(null)}
        onSelectEmployee={canManageDepartments ? setEmpDialogId : undefined}
        canManage={canManageDepartments}
        departments={deptsQuery.data ?? []}
        currentUserRoles={me.roles}
      />
      <EmpProfileDialog
        employeeId={empDialogId}
        onClose={() => setEmpDialogId(null)}
      />

      {!canManageDepartments && (
        <p className="text-xs text-muted-foreground text-center">
          {t("departmentsPage.readOnlyHint")}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/60 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
}

function invalidateDepartmentEmployeeQueries(qc: ReturnType<typeof useQueryClient>, deptId: string | null) {
  qc.invalidateQueries({ queryKey: ["departments"] });
  qc.invalidateQueries({ queryKey: ["employees"] });
  qc.invalidateQueries({ queryKey: ["all-roles"] });
  qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
  qc.invalidateQueries({ queryKey: ["dashboard", "employees-total", "active"] });
  if (deptId) {
    qc.invalidateQueries({ queryKey: ["dept-employees-dialog", deptId] });
    qc.invalidateQueries({ queryKey: ["dept-employees-for-manager", deptId] });
    qc.invalidateQueries({ queryKey: ["other-dept-managers", deptId] });
  }
}

function DeptEmployeesDialog({
  deptId,
  onClose,
  onSelectEmployee,
  canManage,
  departments,
  currentUserRoles,
}: {
  deptId: string | null;
  onClose: () => void;
  onSelectEmployee?: (id: string) => void;
  canManage?: boolean;
  departments: DepartmentRow[];
  currentUserRoles?: AppRole[];
}) {
  const { t } = useTranslation();
  const open = deptId !== null;
  const qc = useQueryClient();
  const updateFn = useServerFn(updateDepartment);
  const [addingEmployee, setAddingEmployee] = useState(false);

  const q = useQuery({
    enabled: open && !!deptId,
    queryKey: ["dept-employees-dialog", deptId],
    queryFn: async () => {
      if (!deptId) return null;
      const { data: dept, error: dErr } = await supabase
        .from("departments")
        .select("id, name, manager_id, is_active")
        .eq("id", deptId)
        .single();
      if (dErr) throw dErr;
      const { data: emps, error: eErr } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name, is_active, on_leave, leave_start_date, leave_end_date, avatar_url, department_id")
        .eq("department_id", deptId)
        .order("first_name")
        .order("last_name");
      if (eErr) throw eErr;
      const empIds = new Set((emps ?? []).map((e: any) => e.id));
      const [{ data: roles }, { data: manager }] = await Promise.all([
        empIds.size
          ? supabase.rpc("list_visible_user_roles")
          : Promise.resolve({ data: [] as any[] }),
        dept.manager_id
          ? supabase.from("profiles").select("first_name, last_name, full_name").eq("id", dept.manager_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      const rolePriority: AppRole[] = [
        "system_admin",
        "main_admin",
        "branch_manager",
        "assistant_manager",
        "department_manager",
        "employee",
      ];
      const roleMap: Record<string, string> = {};
      const bestRank: Record<string, number> = {};
      ((roles ?? []) as any[]).forEach((r: any) => {
        if (!empIds.has(r.user_id)) return;
        const rank = rolePriority.indexOf(r.role as AppRole);
        const normalized = rank === -1 ? rolePriority.length : rank;
        if (bestRank[r.user_id] !== undefined && bestRank[r.user_id] <= normalized) return;
        bestRank[r.user_id] = normalized;
        roleMap[r.user_id] = ROLE_LABELS[r.role as AppRole] ?? r.role;
      });
      const fallbackManager = !manager
        ? (emps ?? []).find((e: any) => roleMap[e.id] === ROLE_LABELS.department_manager)
        : null;
      const resolvedManager = manager ?? fallbackManager;
      return {
        dept,
        deptName: dept.name,
        managerName: resolvedManager ? formatEmployeeName(resolvedManager) : null,
        managerId: dept.manager_id ?? fallbackManager?.id ?? null,
        employees: (emps ?? []).map((e: any) => ({
          ...e,
          roleLabel: roleMap[e.id] ?? i18n.t("departmentsPage.defaultEmployeeRole"),
          isManager: e.id === (dept.manager_id ?? fallbackManager?.id),
        })),
      };
    },
  });

  const otherManagersQuery = useQuery({
    enabled: open && !!deptId && !!canManage,
    queryKey: ["other-dept-managers", deptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, manager_id")
        .neq("id", deptId!)
        .not("manager_id", "is", null);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((d: any) => {
        if (d.manager_id) map[d.manager_id] = d.name;
      });
      return map;
    },
  });

  const setManagerMut = useMutation({
    mutationFn: async (managerId: string | null) => {
      if (!deptId || !q.data?.deptName) throw new Error(t("departmentsPage.deptNotFound"));
      if (managerId && otherManagersQuery.data?.[managerId]) {
        throw new Error(
          t("departmentsPage.managerConflict", { dept: otherManagersQuery.data[managerId] }),
        );
      }
      await updateFn({
        data: {
          id: deptId,
          name: q.data.deptName,
          manager_id: managerId,
          is_active: q.data.dept.is_active,
        },
      });
    },
    onSuccess: (_data, managerId) => {
      toast.success(managerId ? t("departmentsPage.managerUpdated") : t("departmentsPage.managerRemoved"));
      invalidateDepartmentEmployeeQueries(qc, deptId);
    },
    onError: (e: Error) => toast.error(e.message ?? t("departmentsPage.managerUpdateError")),
  });

  const deptRow = departments.find((d) => d.id === deptId);

  return (
    <>
      <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("departmentsPage.employeesOf", { name: q.data?.deptName ?? "—" })}</DialogTitle>
            {q.data?.managerName && (
              <p className="text-sm text-muted-foreground">
                {t("departmentsPage.departmentManagerLabel")}{" "}
                <span className="font-semibold text-foreground">{q.data.managerName}</span>
              </p>
            )}
          </DialogHeader>

          {canManage && (
            <div className="flex flex-wrap gap-2 pb-1">
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                onClick={() => setAddingEmployee(true)}
              >
                <UserPlus className="size-4" />
                {t("departmentsPage.addEmployeeToDept")}
              </Button>
              {q.data?.managerId && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={setManagerMut.isPending}
                  onClick={() => setManagerMut.mutate(null)}
                >
                  {t("departmentsPage.removeDepartmentManager")}
                </Button>
              )}
            </div>
          )}

          {q.isLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="size-5 animate-spin text-primary" />
            </div>
          ) : !q.data || q.data.employees.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              {canManage ? t("departmentsPage.noEmployeesCanManage") : t("departmentsPage.noEmployees")}
            </p>
          ) : (
            <ul className="divide-y max-h-[60vh] overflow-auto">
              {q.data.employees.map((emp: any) => {
                const conflictDept = otherManagersQuery.data?.[emp.id];
                const canSetManager =
                  canManage &&
                  emp.is_active &&
                  !emp.isManager &&
                  !conflictDept;

                return (
                  <li key={emp.id} className="py-3 px-2">
                    <div className="flex items-start justify-between gap-2">
                      {onSelectEmployee ? (
                        <button
                          type="button"
                          onClick={() => onSelectEmployee(emp.id)}
                          className="flex-1 min-w-0 text-right hover:bg-accent/30 rounded-md -m-1 p-1"
                        >
                          <EmployeeListItem emp={emp} />
                        </button>
                      ) : (
                        <div className="flex-1 min-w-0">
                          <EmployeeListItem emp={emp} />
                        </div>
                      )}
                      {canSetManager && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="gap-1 shrink-0 h-8 text-xs"
                          disabled={setManagerMut.isPending}
                          onClick={() => setManagerMut.mutate(emp.id)}
                        >
                          <Crown className="size-3.5" />
                          {t("departmentsPage.departmentManager")}
                        </Button>
                      )}
                    </div>
                    {conflictDept && canManage && !emp.isManager && (
                      <p className="text-xs text-muted-foreground mt-1 mr-1">
                        {t("departmentsPage.managerOfOther", { dept: conflictDept })}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>

      {addingEmployee && deptId && deptRow && (
        <CreateEmployeeDialog
          depts={departments.map((d) => ({ id: d.id, name: d.name, code: d.code }))}
          defaultDepartmentId={deptId}
          lockDepartment
          currentUserRoles={currentUserRoles}
          canEditJobTitle={isPlatformOwner(currentUserRoles ?? [])}
          onClose={() => {
            setAddingEmployee(false);
            invalidateDepartmentEmployeeQueries(qc, deptId);
          }}
        />
      )}
    </>
  );
}

function EmployeeListItem({ emp }: { emp: any }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium truncate">{formatEmployeeName(emp)}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {emp.roleLabel}
          {emp.isManager && (
            <span className="text-primary font-semibold mr-1">{t("departmentsPage.departmentManagerSuffix")}</span>
          )}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {!emp.is_active && (
          <Badge variant="destructive" className="rounded-full text-xs">{t("profile.inactive")}</Badge>
        )}
        {isEmployeeCurrentlyOnLeave(emp) && (
          <Badge variant="secondary" className="rounded-full text-xs">{t("profile.onLeave")}</Badge>
        )}
        {emp.is_active && !isEmployeeCurrentlyOnLeave(emp) && (
          <Badge variant="outline" className="rounded-full text-xs">{t("profile.active")}</Badge>
        )}
      </div>
    </div>
  );
}

function EmpProfileDialog({
  employeeId,
  onClose,
}: {
  employeeId: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const open = employeeId !== null;
  const q = useQuery({
    enabled: open && !!employeeId,
    queryKey: ["employee-profile-dialog", employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name, department_id, job_title, is_active, on_leave, leave_start_date, leave_end_date, avatar_url, departments(name)")
        .eq("id", employeeId)
        .maybeSingle();
      if (pErr) throw pErr;
      const { data: roles } = await supabase.rpc("list_visible_user_roles");
      const roleLabel = ((roles ?? []) as any[])
        .filter((r: any) => r.user_id === employeeId)
        .map((r: any) => ROLE_LABELS[r.role as AppRole])
        .filter(Boolean)
        .join(", ") || "—";
      const { data: contactRows } = await supabase.rpc("get_profile_contact", { _id: employeeId });
      const contact: any = Array.isArray(contactRows) ? contactRows[0] ?? {} : contactRows ?? {};
      let avatarUrl: string | null = null;
      if (profile?.avatar_url) {
        const { data: urlData } = await supabase.storage
          .from("avatars")
          .createSignedUrl(profile.avatar_url, 60 * 60);
        avatarUrl = urlData?.signedUrl ?? null;
      }
      return {
        ...profile,
        id_number: contact.id_number ?? null,
        phone: contact.phone ?? null,
        departmentName: (profile as any)?.departments?.name ?? "—",
        roleLabel,
        avatarUrl,
      };
    },
  });

  const leaveDates = q.data
    ? formatLeaveDateRange(q.data.leave_start_date, q.data.leave_end_date)
    : null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("departmentsPage.employeeDetails")}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">{t("departmentsPage.employeeNotFound")}</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="size-16 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-xl font-bold shrink-0 overflow-hidden">
                {q.data.avatarUrl ? (
                  <img src={q.data.avatarUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <User className="size-7" />
                )}
              </div>
              <div>
                <p className="font-semibold text-lg">{formatEmployeeName(q.data)}</p>
                <p className="text-sm text-muted-foreground">{q.data.roleLabel}</p>
              </div>
            </div>
            <Card className="p-4 space-y-3">
              <ProfileRow label={t("profile.idNumber")} value={q.data.id_number ?? "—"} />
              <ProfileRow label={t("profile.department")} value={q.data.departmentName} />
              <ProfilePhoneField label={t("profile.phone")} phone={q.data.phone} />
              <ProfileRow
                label={t("profile.status")}
                value={
                  isEmployeeCurrentlyOnLeave(q.data)
                    ? t("departmentsPage.onLeaveWithDates", {
                        dates: leaveDates ? ` (${leaveDates})` : "",
                      })
                    : q.data.is_active
                    ? t("profile.active")
                    : t("profile.inactive")
                }
              />
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/60 pb-2 last:border-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}

function CreateDialog({
  managers,
  onClose,
}: {
  managers: ManagerOption[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fn = useServerFn(createDepartment);
  const [form, setForm] = useState({ name: "", manager_id: "" as string });
  const mutation = useMutation({
    mutationFn: async () => {
      await fn({
        data: {
          name: form.name.trim(),
          manager_id: form.manager_id || null,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("departmentsPage.created"));
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("departmentsPage.createError")),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("departmentsPage.createTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("departmentsPage.departmentName")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label={t("departmentsPage.departmentManagerOptional")}>
            <Select value={form.manager_id || "none"} onValueChange={(v) => setForm({ ...form, manager_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("departmentsPage.notDefined")}</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{formatEmployeeName(m)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{t("departmentsPage.activeDepartment")}</p>
              <p className="text-xs text-muted-foreground">
                {t("departmentsPage.deactivateHint")}
              </p>
            </div>
            <Switch checked={true} disabled />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("departmentsPage.create")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  dept,
  onClose,
}: {
  dept: DepartmentRow;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fn = useServerFn(updateDepartment);
  const [form, setForm] = useState({
    name: dept.name,
    manager_id: dept.manager_id ?? "",
    is_active: dept.is_active,
  });

  const deptEmployeesQuery = useQuery({
    queryKey: ["dept-employees-for-manager", dept.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, full_name")
        .eq("department_id", dept.id)
        .eq("is_active", true)
        .order("first_name")
        .order("last_name");
      if (error) throw error;
      return (data ?? []) as ManagerOption[];
    },
  });

  const otherManagersQuery = useQuery({
    queryKey: ["other-dept-managers", dept.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, manager_id")
        .neq("id", dept.id)
        .not("manager_id", "is", null);
      if (error) throw error;
      const map: Record<string, string> = {};
      (data ?? []).forEach((d: any) => {
        if (d.manager_id) map[d.manager_id] = d.name;
      });
      return map;
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel(`dept-edit-${dept.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "profiles" },
        () => {
          qc.invalidateQueries({ queryKey: ["dept-employees-for-manager", dept.id] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "departments" },
        () => {
          qc.invalidateQueries({ queryKey: ["other-dept-managers", dept.id] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [dept.id, qc]);

  const mutation = useMutation({
    mutationFn: async () => {
      const conflictDept =
        form.manager_id && otherManagersQuery.data?.[form.manager_id];
      if (conflictDept) {
        throw new Error(t("departmentsPage.editManagerConflict", { dept: conflictDept }));
      }
      await fn({
        data: {
          id: dept.id,
          name: form.name.trim(),
          manager_id: form.manager_id || null,
          is_active: form.is_active,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("departmentsPage.updated"));
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("departmentsPage.updateError")),
  });

  const employees = deptEmployeesQuery.data ?? [];
  const otherMgrs = otherManagersQuery.data ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("departmentsPage.editTitle")}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label={t("departmentsPage.departmentName")}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label={t("departmentsPage.departmentManager")}>
            <Select value={form.manager_id || "none"} onValueChange={(v) => setForm({ ...form, manager_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t("departmentsPage.notDefined")}</SelectItem>
                {deptEmployeesQuery.isLoading ? (
                  <SelectItem value="__loading" disabled>{t("departmentsPage.loadingEmployees")}</SelectItem>
                ) : employees.length === 0 ? (
                  <SelectItem value="__empty" disabled>{t("departmentsPage.noActiveEmployees")}</SelectItem>
                ) : (
                  employees.map((m) => {
                    const conflict = otherMgrs[m.id];
                    return (
                      <SelectItem key={m.id} value={m.id} disabled={!!conflict}>
                        {formatEmployeeName(m)}
                        {conflict ? t("departmentsPage.managerOfConflict", { dept: conflict }) : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              {t("departmentsPage.managerSelectHint")}
            </p>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">{t("departmentsPage.activeDepartment")}</p>
              <p className="text-xs text-muted-foreground">
                {t("departmentsPage.deactivateHint")}
              </p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("common.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function DeleteDialog({ dept, onClose }: { dept: DepartmentRow; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const fn = useServerFn(deleteDepartment);
  const mutation = useMutation({
    mutationFn: async () => {
      await fn({ data: { id: dept.id } });
    },
    onSuccess: () => {
      toast.success(t("departmentsPage.deleted"));
      qc.invalidateQueries({ queryKey: ["departments"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? t("departmentsPage.deleteError")),
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("departmentsPage.deleteTitle")}</AlertDialogTitle>
          <AlertDialogDescription>
            {t("departmentsPage.deleteDesc", { name: dept.name })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : t("departmentsPage.deleteAction")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
