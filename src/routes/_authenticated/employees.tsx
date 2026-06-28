import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, useMemo, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createEmployee, resetEmployeePassword, deleteEmployee, setEmployeeActive } from "@/lib/employees.functions";
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
import {
  ROLE_LABELS,
  ROLE_OPTIONS,
  isAdmin,
  canManageUsers,
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
import { Search, Loader2, Pencil, UserPlus, Filter, ImagePlus, X, KeyRound, Trash2, Users, UserCheck, UserX, Plane, Coffee, Shield, Power } from "lucide-react";
import { toast } from "sonner";

type FilterMode = "all" | "active" | "inactive" | "on_leave";

interface EmployeesSearch {
  filter?: FilterMode;
  dept?: string;
}

export const Route = createFileRoute("/_authenticated/employees")({
  component: EmployeesPage,
  validateSearch: (s: Record<string, unknown>): EmployeesSearch => ({
    filter: (["all", "active", "inactive", "on_leave"].includes(s.filter as string)
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
  full_name: string;
  id_number: string | null;
  department_id: string | null;
  job_title: string | null;
  phone: string | null;
  is_active: boolean;
  on_leave: boolean;
  avatar_url: string | null;
}

const FILTER_LABELS: Record<FilterMode, string> = {
  all: "👥 כל העובדים",
  active: "🟢 עובדים פעילים",
  inactive: "🔴 עובדים לא פעילים",
  on_leave: "🟡 בחופש",
};


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
  const isMainAdmin = me ? canManageUsers(me.roles) : false;

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

  const employeesQuery = useQuery({
    enabled: allowed,
    queryKey: ["employees"],
    queryFn: async () => {
      const [{ data, error }, { data: contacts, error: cErr }] = await Promise.all([
        supabase
          .from("profiles")
          .select("id, full_name, department_id, job_title, is_active, on_leave, avatar_url")
          .order("full_name"),
        supabase.rpc("list_profiles_contact"),
      ]);
      if (error) throw error;
      if (cErr) throw cErr;
      const cmap: Record<string, { id_number: string | null; phone: string | null }> = {};
      (contacts ?? []).forEach((c: any) => {
        cmap[c.id] = { id_number: c.id_number ?? null, phone: c.phone ?? null };
      });
      return (data ?? []).map((p: any) => ({
        ...p,
        id_number: cmap[p.id]?.id_number ?? null,
        phone: cmap[p.id]?.phone ?? null,
      })) as ProfileRow[];
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

  // Live count of employees currently on an active break
  const activeBreaksQ = useQuery({
    enabled: allowed,
    queryKey: ["employees-page-active-breaks"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("break_requests")
        .select("id", { count: "exact", head: true })
        .eq("status", "active");
      if (error) throw error;
      return count ?? 0;
    },
  });

  // Realtime: refresh stats when profiles, roles, departments, or breaks change
  useEffect(() => {
    if (!allowed) return;
    const ch = supabase
      .channel("employees-page-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        qcPage.invalidateQueries({ queryKey: ["employees"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "user_roles" }, () => {
        qcPage.invalidateQueries({ queryKey: ["all-roles"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "departments" }, () => {
        qcPage.invalidateQueries({ queryKey: ["departments", "options"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "break_requests" }, () => {
        qcPage.invalidateQueries({ queryKey: ["employees-page-active-breaks"] });
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [allowed, qcPage]);

  const filtered = useMemo(() => {
    const data = employeesQuery.data ?? [];
    const term = searchTerm.trim().toLowerCase();
    return data.filter((e) => {
      // Hide department manager from their own employees list
      if (isDeptManagerOnly && e.id === me?.id) return false;
      if (deptFilter !== "all" && e.department_id !== deptFilter) return false;
      if (filterMode === "active" && (!e.is_active || e.on_leave)) return false;
      if (filterMode === "inactive" && e.is_active) return false;
      if (filterMode === "on_leave" && !e.on_leave) return false;
      if (!term) return true;
      return (
        e.full_name.toLowerCase().includes(term) ||
        (e.id_number ?? "").includes(term) ||
        (e.phone ?? "").includes(term)
      );
    });
  }, [employeesQuery.data, searchTerm, deptFilter, filterMode, isDeptManagerOnly, me?.id]);

  // Manager's own department stats (excluding the manager themselves)
  const managerDeptStats = useMemo(() => {
    if (!isDeptManagerOnly || !me?.department_id) return null;
    const data = employeesQuery.data ?? [];
    const dept = data.filter((e) => e.department_id === me.department_id && e.id !== me.id);
    return {
      total: dept.length,
      active: dept.filter((e) => e.is_active && !e.on_leave).length,
      onLeave: dept.filter((e) => e.on_leave).length,
    };
  }, [employeesQuery.data, isDeptManagerOnly, me?.id, me?.department_id]);

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

  // Top-level summary stats (company-wide, scoped by RLS via employeesQuery)
  const summaryStats = useMemo(() => {
    const list = employeesQuery.data ?? [];
    const roles = rolesQuery.data ?? {};
    let managers = 0;
    let workers = 0;
    let onLeave = 0;
    let inactive = 0;
    list.forEach((e) => {
      const r = roles[e.id] ?? [];
      const isManager = r.some((role) => role !== "employee");
      if (isManager) managers += 1;
      else workers += 1;
      if (e.on_leave) onLeave += 1;
      if (!e.is_active) inactive += 1;
    });
    return {
      total: list.length,
      managers,
      workers,
      onLeave,
      inactive,
      onBreak: activeBreaksQ.data ?? 0,
    };
  }, [employeesQuery.data, rolesQuery.data, activeBreaksQ.data]);

  if (meLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="size-6 animate-spin text-primary" /></div>;
  }

  if (!allowed) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">העמוד הזה זמין למנהלים ולאחראי מחלקות.</p>
        <Button className="mt-4" onClick={() => navigate({ to: "/dashboard" })}>חזרה</Button>
      </Card>
    );
  }

  const headerSubtitle = `${filtered.length} מתוך ${employeesQuery.data?.length ?? 0} עובדים · ${FILTER_LABELS[filterMode]}${deptFilter !== "all" && deptMap[deptFilter] ? ` · ${deptMap[deptFilter]}` : ""}`;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">ניהול עובדים</h1>
          {isDeptManagerOnly && me?.department_id && deptMap[me.department_id] && (
            <p className="text-sm font-medium text-primary mt-1">
              מחלקה: {deptMap[me.department_id]}
            </p>
          )}
          <p className="text-sm text-muted-foreground mt-1">{headerSubtitle}</p>
        </div>
        {isMainAdmin && (
          <Button className="gap-2" onClick={() => setCreating(true)}>
            <UserPlus className="size-4" />
            הוספת עובד
          </Button>
        )}
      </header>

      {!isDeptManagerOnly && (
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <SummaryStatCard label="סך עובדים" value={summaryStats.total} icon={<Users className="size-5" />} tone="primary" emoji="👥" />
          <SummaryStatCard label="מנהלים" value={summaryStats.managers} icon={<Shield className="size-5" />} tone="indigo" emoji="👔" />
          <SummaryStatCard label="עובדים" value={summaryStats.workers} icon={<UserCheck className="size-5" />} tone="green" emoji="👤" />
          <SummaryStatCard label="בחופשה" value={summaryStats.onLeave} icon={<Plane className="size-5" />} tone="sky" emoji="🏖️" />
          <SummaryStatCard label="בהפסקה" value={summaryStats.onBreak} icon={<Coffee className="size-5" />} tone="amber" emoji="☕" />
          <SummaryStatCard label="לא פעילים" value={summaryStats.inactive} icon={<UserX className="size-5" />} tone="red" emoji="🚫" />
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
                    {(me.full_name || "?").charAt(0)}
                  </span>
                );
              })()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-muted-foreground">👤 אחראי המחלקה</div>
              <div className="font-semibold truncate">{me.full_name}</div>
              <div className="text-sm text-muted-foreground truncate">
                {me.department_name ?? (me.department_id ? deptMap[me.department_id] : "")}
                {me.job_title ? ` · ${me.job_title}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 justify-end">
              <Badge variant="secondary">עובדים: {managerDeptStats.total}</Badge>
              <Badge variant="outline">פעילים: {managerDeptStats.active}</Badge>
              {managerDeptStats.onLeave > 0 && (
                <Badge variant="outline">בחופש: {managerDeptStats.onLeave}</Badge>
              )}
            </div>
          </div>
        </Card>
      )}



      <Card className="card-elevated p-4">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              placeholder="חיפוש לפי שם, ת.ז, טלפון..."
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
                <SelectItem value="active">{FILTER_LABELS.active}</SelectItem>
                <SelectItem value="inactive">{FILTER_LABELS.inactive}</SelectItem>
                <SelectItem value="all">{FILTER_LABELS.all}</SelectItem>
                <SelectItem value="on_leave">{FILTER_LABELS.on_leave}</SelectItem>

              </SelectContent>
            </Select>
            {!isDeptManagerOnly && (
              <Select value={deptFilter} onValueChange={setDept}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">כל המחלקות</SelectItem>
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
              deptName={emp.department_id ? deptMap[emp.department_id] : null}
              roles={rolesQuery.data?.[emp.id] ?? []}
              avatarUrl={emp.avatar_url ? (avatarMap[emp.avatar_url] ?? avatarUrlFor(emp.avatar_url)) : null}
              onEdit={() => setEditing(emp)}
              onResetPassword={() => setResetting(emp)}
              onDelete={() => setDeleting(emp)}
              canEdit={isMainAdmin}
              canResetPassword={isMainAdmin}
              canDelete={isMainAdmin && emp.id !== me?.id}
            />
          ))}
        </div>
      )}

      {resetting && isMainAdmin && (
        <ResetPasswordDialog employee={resetting} onClose={() => setResetting(null)} />
      )}

      {deleting && isMainAdmin && (
        <DeleteEmployeeDialog employee={deleting} onClose={() => setDeleting(null)} />
      )}

      {editing && me && isMainAdmin && (
        <EditEmployeeDialog
          employee={editing}
          depts={deptsQuery.data ?? []}
          currentRoles={rolesQuery.data?.[editing.id] ?? []}
          canEditRoles={canManageUsers(me.roles)}
          onClose={() => setEditing(null)}
        />
      )}

      {creating && isMainAdmin && (
        <CreateEmployeeDialog depts={deptsQuery.data ?? []} onClose={() => setCreating(false)} />
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
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(initialUrl);

  return (
    <div className="flex items-center gap-3">
      <div className="size-16 rounded-full bg-accent overflow-hidden flex items-center justify-center shrink-0 border border-border">
        {preview ? (
          <img src={preview} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus className="size-6 text-muted-foreground" />
        )}
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
          {preview ? "החלפת תמונה" : "העלאת תמונה"}
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
            toast.error("הקובץ גדול מדי (מקסימום 5MB)");
            return;
          }
          setPreview(URL.createObjectURL(f));
          onFileSelected(f);
        }}
      />
    </div>
  );
}

function CreateEmployeeDialog({ depts, onClose }: { depts: DeptOption[]; onClose: () => void }) {
  const qc = useQueryClient();
  const createFn = useServerFn(createEmployee);
  const defaultDept = depts[0]?.id ?? "";
  const [form, setForm] = useState({
    full_name: "",
    id_number: "",
    department_id: defaultDept,
    phone: "",
    password: "",
    role: "employee" as AppRole,
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error("יש לבחור מחלקה");
      if (!/^\d{5,15}$/.test(form.id_number)) throw new Error("מספר זהות חייב להכיל 5–15 ספרות");
      if (form.password.length < 6) throw new Error("סיסמה ראשונית של 6 תווים לפחות");
      if (!form.full_name.trim()) throw new Error("יש למלא שם עובד");
      const res = await createFn({ data: { ...form, job_title: "", avatar_url: null } });
      if (avatarFile && res?.id) {
        try {
          const path = await uploadAvatar(avatarFile, res.id);
          await supabase.from("profiles").update({ avatar_url: path }).eq("id", res.id);
        } catch (e: any) {
          toast.error("העובד נוצר אך העלאת התמונה נכשלה: " + (e?.message ?? ""));
        }
      }
    },
    onSuccess: () => {
      toast.success("העובד נוצר. סיסמה ראשונית — העובד יחויב להחליפה בכניסה הראשונה.");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
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
          autoComplete="off"
        >
          {/* Honeypot fields to defeat browser autofill of admin credentials */}
          <input type="text" name="username" autoComplete="username" className="hidden" tabIndex={-1} />
          <input type="password" name="password" autoComplete="current-password" className="hidden" tabIndex={-1} />

          <Field label="תמונת פרופיל (אופציונלי)">
            <AvatarPicker
              initialUrl={null}
              onFileSelected={setAvatarFile}
              onCleared={() => setAvatarFile(null)}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="שם עובד">
              <Input
                value={form.full_name}
                onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                required
                maxLength={100}
                autoComplete="off"
                name="emp_full_name"
              />
            </Field>
            <Field label="מספר זהות">
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
            <Field label="מחלקה">
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="בחר מחלקה" /></SelectTrigger>
                <SelectContent>
                  {depts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="טלפון">
              <Input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                dir="ltr"
                maxLength={20}
                autoComplete="off"
                name="emp_phone_new"
              />
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
  deptName,
  roles,
  avatarUrl,
  onEdit,
  onResetPassword,
  onDelete,
  canEdit,
  canResetPassword,
  canDelete,
}: {
  emp: ProfileRow;
  deptName: string | null;
  roles: AppRole[];
  avatarUrl: string | null;
  onEdit: () => void;
  onResetPassword: () => void;
  onDelete: () => void;
  canEdit: boolean;
  canResetPassword: boolean;
  canDelete: boolean;
}) {
  return (
    <Card className="card-elevated p-4">
      <div className="flex items-center gap-4">
        <div className="size-12 rounded-full bg-accent text-accent-foreground flex items-center justify-center text-base font-semibold shrink-0 overflow-hidden">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            <span>{emp.full_name?.charAt(0) || "?"}</span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold truncate">{emp.full_name || "ללא שם"}</p>
            {!emp.is_active && <Badge variant="destructive" className="rounded-full text-xs">לא פעיל</Badge>}
            {emp.on_leave && <Badge variant="secondary" className="rounded-full text-xs">בחופש</Badge>}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {deptName ?? "ללא מחלקה"}
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
        <div className="flex items-center gap-1 shrink-0">
          {canResetPassword && (
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={onResetPassword} aria-label="איפוס סיסמה">
              <KeyRound className="size-4" />
              <span className="hidden sm:inline">איפוס סיסמה</span>
            </Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="icon" onClick={onEdit} aria-label="עריכה">
              <Pencil className="size-4" />
            </Button>
          )}
          {canDelete && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete} aria-label="מחק עובד לצמיתות">
              <Trash2 className="size-4" />
              <span className="hidden sm:inline">מחק לצמיתות</span>
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function DeleteEmployeeDialog({ employee, onClose }: { employee: ProfileRow; onClose: () => void }) {
  const qc = useQueryClient();
  const deleteFn = useServerFn(deleteEmployee);
  const mutation = useMutation({
    mutationFn: async () => {
      await deleteFn({ data: { user_id: employee.id } });
    },
    onSuccess: () => {
      toast.success("העובד נמחק לצמיתות מהמערכת");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "stats"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקת העובד"),
  });

  return (
    <AlertDialog open onOpenChange={(o) => !o && !mutation.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>מחיקת עובד לצמיתות</AlertDialogTitle>
          <AlertDialogDescription>
            פעולה זו תמחק את <strong>{employee.full_name || "העובד"}</strong> לצמיתות: חשבון ההתחברות, פרטי המחלקה, ההרשאות, תמונת הפרופיל וכל הנתונים. לא ניתן לבטל פעולה זו.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>ביטול</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "מחק לצמיתות"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ResetPasswordDialog({ employee, onClose }: { employee: ProfileRow; onClose: () => void }) {
  const resetFn = useServerFn(resetEmployeePassword);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      if (password.length < 6) throw new Error("סיסמה חייבת להכיל לפחות 6 תווים");
      if (password !== confirm) throw new Error("הסיסמאות אינן תואמות");
      await resetFn({ data: { user_id: employee.id, password } });
    },
    onSuccess: () => {
      toast.success("הסיסמה אופסה. העובד יכול להתחבר עם הסיסמה החדשה.");
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה באיפוס הסיסמה"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>איפוס סיסמה — {employee.full_name || "עובד"}</DialogTitle>
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

          <Field label="סיסמה חדשה">
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
          <Field label="אימות סיסמה">
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
            הסיסמה תישמר מיד והעובד יוכל להתחבר איתה — אין צורך בקישור או בתהליך נוסף.
          </p>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "אפס סיסמה"}
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
  onClose,
}: {
  employee: ProfileRow;
  depts: DeptOption[];
  currentRoles: AppRole[];
  canEditRoles: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    full_name: employee.full_name,
    id_number: employee.id_number ?? "",
    department_id: employee.department_id ?? "",
    phone: employee.phone ?? "",
    is_active: employee.is_active,
    on_leave: employee.on_leave,
    role: (currentRoles[0] ?? "employee") as AppRole,
    avatar_url: employee.avatar_url,
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.department_id) throw new Error("יש לבחור מחלקה");
      const selected = depts.find((d) => d.id === form.department_id);
      if (!selected) throw new Error("מחלקה לא נמצאה");

      let avatar_url: string | null = form.avatar_url;
      if (removeAvatar) avatar_url = null;
      if (avatarFile) {
        avatar_url = await uploadAvatar(avatarFile, employee.id);
      }

      const { error: pErr } = await supabase
        .from("profiles")
        .update({
          full_name: form.full_name,
          id_number: form.id_number || null,
          department_id: form.department_id,
          phone: form.phone || null,
          is_active: form.is_active,
          on_leave: form.on_leave,
          avatar_url,
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

      // Auto-link department manager
      if (canEditRoles && form.role === "department_manager") {
        await supabase
          .from("departments")
          .update({ manager_id: employee.id })
          .eq("id", form.department_id);
      } else if (canEditRoles && currentRoles[0] === "department_manager" && form.role !== "department_manager") {
        // Unlink if previously managed
        await supabase
          .from("departments")
          .update({ manager_id: null })
          .eq("manager_id", employee.id);
      }
    },
    onSuccess: () => {
      toast.success("העובד עודכן");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["all-roles"] });
      qc.invalidateQueries({ queryKey: ["departments"] });
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
          autoComplete="off"
        >
          <Field label="תמונת פרופיל">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="שם עובד">
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required autoComplete="off" />
            </Field>
            <Field label="מספר זהות">
              <Input value={form.id_number} onChange={(e) => setForm({ ...form, id_number: e.target.value })} dir="ltr" autoComplete="off" />
            </Field>
            <Field label="טלפון">
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" autoComplete="off" />
            </Field>
            <Field label="מחלקה">
              <Select value={form.department_id} onValueChange={(v) => setForm({ ...form, department_id: v })}>
                <SelectTrigger><SelectValue placeholder="בחר מחלקה" /></SelectTrigger>
                <SelectContent>
                  {depts.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
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

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium">בחופש</p>
              <p className="text-xs text-muted-foreground">
                {form.on_leave ? "העובד נמצא כעת בחופש" : "העובד אינו בחופש"}
              </p>
            </div>
            <Switch
              checked={form.on_leave}
              onCheckedChange={(v) => setForm({ ...form, on_leave: v })}
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

function SummaryStatCard({
  label,
  value,
  icon,
  tone,
  emoji,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: "primary" | "green" | "red" | "sky" | "amber" | "indigo";
  emoji: string;
}) {
  const toneClasses: Record<string, string> = {
    primary: "bg-primary/10 text-primary",
    green: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    red: "bg-red-500/10 text-red-600 dark:text-red-400",
    sky: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    amber: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    indigo: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  };
  return (
    <Card className="card-elevated p-3">
      <div className="flex items-center gap-3">
        <div className={`size-10 rounded-xl flex items-center justify-center shrink-0 ${toneClasses[tone]}`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground truncate">
            <span className="me-1">{emoji}</span>
            {label}
          </p>
          <p className="text-xl font-bold leading-tight">{value}</p>
        </div>
      </div>
    </Card>
  );
}
