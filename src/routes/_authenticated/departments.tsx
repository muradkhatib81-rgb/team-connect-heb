import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { canManageUsers, ROLE_LABELS, type AppRole } from "@/lib/constants";
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
import { Loader2, Building2, Plus, Pencil, Trash2, User } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/departments")({
  component: DepartmentsPage,
});

interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  manager_id: string | null;
  is_active: boolean;
}

interface ManagerOption {
  id: string;
  full_name: string;
}

function DepartmentsPage() {
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useAuth();
  const canManageDepartments = me ? canManageUsers(me.roles) : false;
  const qcRT = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);
  const [deptDialogId, setDeptDialogId] = useState<string | null>(null);
  const [empDialogId, setEmpDialogId] = useState<string | null>(null);

  useEffect(() => {
    if (!me) return;
    const ch = supabase
      .channel("departments-page-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        qcRT.invalidateQueries({ queryKey: ["departments", "counts"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => {
        qcRT.invalidateQueries({ queryKey: ["departments", "list"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [me, qcRT]);

  const deptsQuery = useQuery({
    enabled: !!me,
    queryKey: ["departments", "list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, code, manager_id, is_active")
        .order("name");
      if (error) throw error;
      return data as DepartmentRow[];
    },
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
        .select("id, full_name")
        .eq("is_active", true)
        .order("full_name");
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
          <h1 className="text-2xl sm:text-3xl font-bold">מחלקות הסניף</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ניהול מחלקות, אחראים וכמות עובדים
          </p>
        </div>
        {canManageDepartments && (
          <Button className="gap-2" onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            הוספת מחלקה
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
            const mgr = managersQuery.data?.find((m) => m.id === d.manager_id);
            return (
              <Card
                key={d.id}
                className="card-elevated p-5 cursor-pointer hover:bg-accent/30 transition-colors"
                onClick={() => setDeptDialogId(d.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold truncate">{d.name}</h2>
                    <p className="text-xs text-muted-foreground mt-1">
                      אחראי: {mgr?.full_name ?? "לא הוגדר"}
                    </p>
                  </div>
                  <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                    <Building2 className="size-5" />
                  </div>
                </div>
                <div className="mt-4">
                  <Stat label="סך עובדים" value={c.total} />
                </div>
                <div className="flex items-center justify-between mt-4">
                  {!d.is_active && (
                    <Badge variant="destructive" className="rounded-full">לא פעילה</Badge>
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
                        aria-label="עריכה"
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
                        aria-label="מחיקה"
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
      />
      <EmpProfileDialog
        employeeId={empDialogId}
        onClose={() => setEmpDialogId(null)}
      />

      {!canManageDepartments && (
        <p className="text-xs text-muted-foreground text-center">
רק מנהל מורשה יכול ליצור, לערוך או למחוק מחלקות בסניף שלו.
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

function DeptEmployeesDialog({
  deptId,
  onClose,
  onSelectEmployee,
}: {
  deptId: string | null;
  onClose: () => void;
  onSelectEmployee?: (id: string) => void;
}) {
  const open = deptId !== null;
  const q = useQuery({
    enabled: open && !!deptId,
    queryKey: ["dept-employees-dialog", deptId],
    queryFn: async () => {
      if (!deptId) return null;
      const { data: dept, error: dErr } = await supabase
        .from("departments")
        .select("id, name, manager_id")
        .eq("id", deptId)
        .single();
      if (dErr) throw dErr;
      const { data: emps, error: eErr } = await supabase
        .from("profiles")
        .select("id, full_name, is_active, on_leave, avatar_url, department_id")
        .eq("department_id", deptId)
        .order("full_name");
      if (eErr) throw eErr;
      const empIds = (emps ?? []).map((e: any) => e.id);
      const [{ data: roles }, { data: manager }] = await Promise.all([
        empIds.length
          ? supabase.from("user_roles").select("user_id, role").in("user_id", empIds)
          : Promise.resolve({ data: [] as any[] }),
        dept.manager_id
          ? supabase.from("profiles").select("full_name").eq("id", dept.manager_id).maybeSingle()
          : Promise.resolve({ data: null as any }),
      ]);
      const roleMap: Record<string, string> = {};
      (roles ?? []).forEach((r: any) => {
        roleMap[r.user_id] = ROLE_LABELS[r.role as AppRole] ?? r.role;
      });
      return {
        deptName: dept.name,
        managerName: manager?.full_name ?? null,
        managerId: dept.manager_id,
        employees: (emps ?? []).map((e: any) => ({
          ...e,
          roleLabel: roleMap[e.id] ?? "עובד",
          isManager: e.id === dept.manager_id,
        })),
      };
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עובדי {q.data?.deptName ?? "—"}</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data || q.data.employees.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">אין עובדים במחלקה זו.</p>
        ) : (
          <ul className="divide-y max-h-[60vh] overflow-auto">
            {q.data.employees.map((emp: any) => (
              <li key={emp.id}>
                {onSelectEmployee ? (
                  <button
                    type="button"
                    onClick={() => onSelectEmployee(emp.id)}
                    className="w-full text-right py-3 px-2 hover:bg-accent/30 rounded-md"
                  >
                    <EmployeeListItem emp={emp} />
                  </button>
                ) : (
                  <div className="py-3 px-2">
                    <EmployeeListItem emp={emp} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EmployeeListItem({ emp }: { emp: any }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="font-medium truncate">{emp.full_name || "ללא שם"}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {emp.roleLabel}
          {emp.isManager && (
            <span className="text-primary font-semibold mr-1">· אחראי מחלקה</span>
          )}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {!emp.is_active && (
          <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>
        )}
        {emp.on_leave && (
          <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>
        )}
        {emp.is_active && !emp.on_leave && (
          <Badge variant="outline" className="rounded-full text-xs">פעיל</Badge>
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
  const open = employeeId !== null;
  const q = useQuery({
    enabled: open && !!employeeId,
    queryKey: ["employee-profile-dialog", employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const { data: profile, error: pErr } = await supabase
        .from("profiles")
        .select("id, full_name, department_id, job_title, is_active, on_leave, avatar_url, departments(name)")
        .eq("id", employeeId)
        .maybeSingle();
      if (pErr) throw pErr;
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", employeeId);
      const roleLabel = (roles ?? [])
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>פרטי עובד</DialogTitle>
        </DialogHeader>
        {q.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-5 animate-spin text-primary" />
          </div>
        ) : !q.data ? (
          <p className="text-sm text-muted-foreground py-6 text-center">לא נמצאו פרטי עובד.</p>
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
                <p className="font-semibold text-lg">{q.data.full_name || "ללא שם"}</p>
                <p className="text-sm text-muted-foreground">{q.data.roleLabel}</p>
              </div>
            </div>
            <Card className="p-4 space-y-3">
              <ProfileRow label="מספר זהות" value={q.data.id_number ?? "—"} />
              <ProfileRow label="מחלקה" value={q.data.departmentName} />
              <ProfileRow label="טלפון" value={q.data.phone ?? "—"} />
              <ProfileRow
                label="סטטוס"
                value={
                  q.data.on_leave
                    ? "בחופש"
                    : q.data.is_active
                    ? "פעיל"
                    : "לא פעיל"
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
  const qc = useQueryClient();
  const navigate = useNavigate();
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
      toast.success("המחלקה נוצרה");
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה ביצירת מחלקה"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>הוספת מחלקה חדשה</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="שם המחלקה">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label="אחראי מחלקה (אופציונלי)">
            <Select value={form.manager_id || "none"} onValueChange={(v) => setForm({ ...form, manager_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">לא הוגדר</SelectItem>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">מחלקה פעילה</p>
              <p className="text-xs text-muted-foreground">
                ניתן להשבית מחלקה מבלי למחוק אותה
              </p>
            </div>
            <Switch checked={true} disabled />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "צור"}
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
  const qc = useQueryClient();
  const fn = useServerFn(updateDepartment);
  const [form, setForm] = useState({
    name: dept.name,
    manager_id: dept.manager_id ?? "",
    is_active: dept.is_active,
  });

  // Only employees of THIS department are eligible to be its manager.
  const deptEmployeesQuery = useQuery({
    queryKey: ["dept-employees-for-manager", dept.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("department_id", dept.id)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as ManagerOption[];
    },
  });

  // Other departments' managers, to prevent assigning the same employee to two departments.
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

  // Auto-refresh employee list when profiles change (employee moves between departments).
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
        throw new Error(
          `העובד כבר משמש כאחראי של מחלקת "${conflictDept}". לא ניתן להגדיר אותו כאחראי של שתי מחלקות במקביל.`,
        );
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
      toast.success("המחלקה עודכנה");
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });

  const employees = deptEmployeesQuery.data ?? [];
  const otherMgrs = otherManagersQuery.data ?? {};

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>עריכת מחלקה</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
        >
          <Field label="שם המחלקה">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
          </Field>
          <Field label="אחראי מחלקה">
            <Select value={form.manager_id || "none"} onValueChange={(v) => setForm({ ...form, manager_id: v === "none" ? "" : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">לא הוגדר</SelectItem>
                {deptEmployeesQuery.isLoading ? (
                  <SelectItem value="__loading" disabled>טוען עובדים…</SelectItem>
                ) : employees.length === 0 ? (
                  <SelectItem value="__empty" disabled>אין עובדים פעילים במחלקה זו</SelectItem>
                ) : (
                  employees.map((m) => {
                    const conflict = otherMgrs[m.id];
                    return (
                      <SelectItem key={m.id} value={m.id} disabled={!!conflict}>
                        {m.full_name}
                        {conflict ? ` (אחראי ב"${conflict}")` : ""}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              מוצגים רק עובדי המחלקה. עובד יכול להיות אחראי של מחלקה אחת בלבד.
            </p>
          </Field>
          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">מחלקה פעילה</p>
              <p className="text-xs text-muted-foreground">
                ניתן להשבית מחלקה מבלי למחוק אותה
              </p>
            </div>
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "שמירה"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}


function DeleteDialog({ dept, onClose }: { dept: DepartmentRow; onClose: () => void }) {
  const qc = useQueryClient();
  const fn = useServerFn(deleteDepartment);
  const mutation = useMutation({
    mutationFn: async () => {
      await fn({ data: { id: dept.id } });
    },
    onSuccess: () => {
      toast.success("המחלקה נמחקה");
      qc.invalidateQueries({ queryKey: ["departments"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת מחלקה</AlertDialogTitle>
          <AlertDialogDescription>
            האם למחוק את המחלקה "{dept.name}"? לא ניתן לבטל פעולה זו.
            מחלקה עם עובדים משויכים לא תימחק.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>ביטול</AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "מחק"}
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
