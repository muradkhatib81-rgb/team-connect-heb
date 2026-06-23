import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createEmployee } from "@/lib/employees.functions";
import { useAuth } from "@/lib/use-auth";
import {
  DEPARTMENT_LABELS,
  DEPARTMENT_OPTIONS,
  ROLE_LABELS,
  ROLE_OPTIONS,
  isAdmin,
  canManageUsers,
  type AppRole,
  type Department,
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
import { Search, Loader2, Pencil, UserPlus, Filter } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/employees")({
  component: EmployeesPage,
});

interface ProfileRow {
  id: string;
  full_name: string;
  id_number: string | null;
  department: Department;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
}

function EmployeesPage() {
  const navigate = useNavigate();
  const { data: me, isLoading: meLoading } = useAuth();
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<Department | "all">("all");
  const [editing, setEditing] = useState<ProfileRow | null>(null);
  const [creating, setCreating] = useState(false);

  const allowed = me ? isAdmin(me.roles) : false;
  const isMainAdmin = me ? canManageUsers(me.roles) : false;

  const employeesQuery = useQuery({
    enabled: allowed,
    queryKey: ["employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, id_number, department, job_title, phone, is_active")
        .order("full_name");
      if (error) throw error;
      return data as ProfileRow[];
    },
  });

  const rolesQuery = useQuery({
    enabled: allowed,
    queryKey: ["all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("user_id, role");
      if (error) throw error;
      const map: Record<string, AppRole[]> = {};
      data.forEach((r) => {
        map[r.user_id] ||= [];
        map[r.user_id].push(r.role as AppRole);
      });
      return map;
    },
  });

  const filtered = useMemo(() => {
    const data = employeesQuery.data ?? [];
    const term = search.trim().toLowerCase();
    return data.filter((e) => {
      if (deptFilter !== "all" && e.department !== deptFilter) return false;
      if (!term) return true;
      return (
        e.full_name.toLowerCase().includes(term) ||
        (e.id_number ?? "").includes(term) ||
        (e.phone ?? "").includes(term) ||
        (e.job_title ?? "").toLowerCase().includes(term)
      );
    });
  }, [employeesQuery.data, search, deptFilter]);

  if (meLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">העמוד הזה זמין רק למנהלים.</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>חזרה</Button>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">ניהול עובדים</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {filtered.length} מתוך {employeesQuery.data?.length ?? 0} עובדים
          </p>
        </div>
        {isMainAdmin && (
          <Button className="gap-2" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" />
            הוספת עובד
          </Button>
        )}
      </header>

      <Card className="card-elevated p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש לפי שם, ת.ז, טלפון..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pr-10"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="size-4 text-muted-foreground" />
            <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v as any)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">כל המחלקות</SelectItem>
                {DEPARTMENT_OPTIONS.map((d) => (
                  <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {employeesQuery.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : filtered.length === 0 ? (
        <Card className="card-elevated p-10 text-center text-muted-foreground">
          לא נמצאו עובדים
        </Card>
      ) : (
        <div className="grid gap-3">
          {filtered.map((emp) => (
            <EmployeeRow
              key={emp.id}
              emp={emp}
              roles={rolesQuery.data?.[emp.id] ?? []}
              onEdit={() => setEditing(emp)}
            />
          ))}
        </div>
      )}

      {editing && me && (
        <EditEmployeeDialog
          employee={editing}
          currentRoles={rolesQuery.data?.[editing.id] ?? []}
          canEditRoles={canManageUsers(me.roles)}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && isMainAdmin && (
        <CreateEmployeeDialog onClose={() => setCreating(false)} />
      )}
    </div>
  );
}

function CreateEmployeeDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createEmployee);
  const [form, setForm] = useState({
    full_name: "",
    id_number: "",
    department: "general" as Department,
    job_title: "",
    phone: "",
    password: "",
    role: "employee" as AppRole,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      if (!/^\d{5,15}$/.test(form.id_number)) throw new Error("מספר זהות חייב להכיל 5–15 ספרות");
      if (form.password.length < 6) throw new Error("סיסמה ראשונית של 6 תווים לפחות");
      if (!form.full_name.trim()) throw new Error("יש למלא שם עובד");
      await createFn({ data: form });
    },
    onSuccess: () => {
      toast.success("העובד נוצר. סיסמה ראשונית — העובד יחויב להחליפה בכניסה הראשונה.");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה ביצירת עובד"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>הוספת עובד חדש</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="שם עובד">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required maxLength={100} />
            </Field>
            <Field label="מספר זהות">
              <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} required dir="ltr" inputMode="numeric" pattern="\d*" maxLength={15} />
            </Field>
            <Field label="מחלקה">
              <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v as Department })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="תפקיד (טקסט חופשי)">
              <Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} maxLength={80} placeholder="לדוגמה: קופאי" />
            </Field>
            <Field label="טלפון">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" maxLength={20} />
            </Field>
            <Field label="הרשאה">
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="סיסמה ראשונית">
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} dir="ltr" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            העובד יחויב להחליף את הסיסמה הראשונית בכניסה הראשונה למערכת.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "צור עובד"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmployeeRow({
  emp,
  roles,
  onEdit,
}: {
  emp: ProfileRow;
  roles: AppRole[];
  onEdit: () => void;
}) {
  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center gap-4">
        <div className="size-12 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-base font-semibold shrink-0">
          {emp.full_name?.charAt(0) || "?"}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold truncate">{emp.full_name || "ללא שם"}</p>
            {!emp.is_active && <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {emp.job_title || "—"} · {DEPARTMENT_LABELS[emp.department]}
            {emp.phone ? ` · ${emp.phone}` : ""}
          </p>
          {roles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {roles.map((r) => (
                <Badge key={r} variant="secondary" className="rounded-full text-xs">{ROLE_LABELS[r]}</Badge>
              ))}
            </div>
          )}
        </div>
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label="עריכה">
          <Pencil className="size-4" />
        </Button>
      </div>
    </Card>
  );
}

function EditEmployeeDialog({
  employee,
  currentRoles,
  canEditRoles,
  onClose,
}: {
  employee: ProfileRow;
  currentRoles: AppRole[];
  canEditRoles: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: employee.full_name,
    id_number: employee.id_number ?? "",
    department: employee.department,
    job_title: employee.job_title ?? "",
    phone: employee.phone ?? "",
    is_active: employee.is_active,
    role: (currentRoles[0] ?? "employee") as AppRole,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name,
          id_number: form.id_number || null,
          department: form.department,
          job_title: form.job_title || null,
          phone: form.phone || null,
          is_active: form.is_active,
        })
        .eq("id", employee.id);
      if (pErr) throw pErr;

      if (canEditRoles && form.role !== currentRoles[0]) {
        const { error: dErr } = await supabase.from("user_roles").delete().eq("user_id", employee.id);
        if (dErr) throw dErr;
        const { error: iErr } = await supabase
          .from("user_roles")
          .insert({ user_id: employee.id, role: form.role });
        if (iErr) throw iErr;
      }
    },
    onSuccess: () => {
      toast.success("העובד עודכן");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה בעדכון");
    },
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>עריכת עובד</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate();
          }}
          className="space-y-4"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="שם עובד">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
            </Field>
            <Field label="מספר זהות">
              <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} dir="ltr" />
            </Field>
            <Field label="תפקיד">
              <Input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} />
            </Field>
            <Field label="טלפון">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
            </Field>
            <Field label="מחלקה">
              <Select value={form.department} onValueChange={(v) => setForm({ ...form, department: v as Department })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DEPARTMENT_OPTIONS.map((d) => (
                    <SelectItem key={d} value={d}>{DEPARTMENT_LABELS[d]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {canEditRoles && (
              <Field label="הרשאה">
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as AppRole })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((r) => (
                      <SelectItem key={r} value={r}>{ROLE_LABELS[r]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">סטטוס</p>
              <p className="text-xs text-muted-foreground">
                {form.is_active ? "העובד פעיל במערכת" : "העובד אינו פעיל"}
              </p>
            </div>
            <Switch
              checked={form.is_active}
              onCheckedChange={(v) => setForm({ ...form, is_active: v })}
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "שמירה"}
            </Button>
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
