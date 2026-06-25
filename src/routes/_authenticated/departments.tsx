import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { canManageUsers } from "@/lib/constants";
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
  DialogFooter,
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
import { Loader2, Building2, Plus, Pencil, Trash2 } from "lucide-react";
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
  const isMainAdmin = me ? canManageUsers(me.roles) : false;

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<DepartmentRow | null>(null);
  const [deleting, setDeleting] = useState<DepartmentRow | null>(null);

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
    enabled: !!me && isMainAdmin,
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
        {isMainAdmin && (
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
              <Card key={d.id} className="card-elevated p-5">
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
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <Stat label="סך עובדים" value={c.total} />
                  <Stat label="פעילים" value={c.active} />
                </div>
                <div className="flex items-center justify-between mt-4">
                  {!d.is_active && (
                    <Badge variant="destructive" className="rounded-full">לא פעילה</Badge>
                  )}
                  {isMainAdmin && (
                    <div className="flex gap-1 mr-auto">
                      <Button variant="ghost" size="icon" onClick={() => setEditing(d)} aria-label="עריכה">
                        <Pencil className="size-4" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => setDeleting(d)} aria-label="מחיקה">
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

      {creating && isMainAdmin && (
        <CreateDialog managers={managersQuery.data ?? []} onClose={() => setCreating(false)} />
      )}
      {editing && isMainAdmin && (
        <EditDialog
          dept={editing}
          managers={managersQuery.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && isMainAdmin && (
        <DeleteDialog dept={deleting} onClose={() => setDeleting(null)} />
      )}

      {!isMainAdmin && (
        <p className="text-xs text-muted-foreground text-center">
          רק מנהל ראשי יכול ליצור, לערוך או למחוק מחלקות.
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

function CreateDialog({
  managers,
  onClose,
}: {
  managers: ManagerOption[];
  onClose: () => void;
}) {
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
      toast.success("המחלקה נוצרה");
      qc.invalidateQueries({ queryKey: ["departments"] });
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
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={onClose}>ביטול</Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? <Loader2 className="size-4 animate-spin" /> : "צור"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({
  dept,
  managers,
  onClose,
}: {
  dept: DepartmentRow;
  managers: ManagerOption[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fn = useServerFn(updateDepartment);
  const [form, setForm] = useState({
    name: dept.name,
    manager_id: dept.manager_id ?? "",
    is_active: dept.is_active,
  });
  const mutation = useMutation({
    mutationFn: async () => {
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
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });
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
            <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
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
