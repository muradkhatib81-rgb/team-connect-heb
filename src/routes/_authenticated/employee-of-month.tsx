import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useCanManageEom } from "@/lib/use-eom-perm";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trophy, Plus, Pencil, Trash2, Loader2, Upload, History, ImageOff } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/employee-of-month")({
  component: EomManagePage,
});

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

type Row = {
  id: string;
  year: number;
  month: number;
  employee_id: string;
  reason: string | null;
  image_url: string | null;
  created_at: string;
};
type Profile = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  job_title: string | null;
  departments: { name: string } | null;
};

async function signUrl(bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

function EomManagePage() {
  const { data: me } = useAuth();
  const canManage = useCanManageEom();
  const qc = useQueryClient();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const yearOptions = useMemo(() => {
    const arr: number[] = [];
    for (let y = now.getFullYear() + 1; y >= 2023; y--) arr.push(y);
    return arr;
  }, []);

  const monthQ = useQuery({
    queryKey: ["eom-manage", year, month],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("employee_of_month")
        .select("id, year, month, employee_id, reason, image_url, created_at")
        .eq("year", year).eq("month", month)
        .order("created_at");
      if (error) throw error;
      const list = (rows ?? []) as Row[];
      const ids = Array.from(new Set(list.map((r) => r.employee_id)));
      const profiles: Record<string, Profile> = {};
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, job_title, departments(name)")
          .in("id", ids);
        (ps ?? []).forEach((p: any) => (profiles[p.id] = p));
      }
      const imgs = await Promise.all(list.map(async (r) => [r.id, await signUrl("employee-of-month", r.image_url)] as const));
      const avs = await Promise.all(ids.map(async (id) => [id, await signUrl("avatars", profiles[id]?.avatar_url ?? null)] as const));
      return {
        list,
        profiles,
        images: Object.fromEntries(imgs) as Record<string, string | null>,
        avatars: Object.fromEntries(avs) as Record<string, string | null>,
      };
    },
  });

  const historyQ = useQuery({
    queryKey: ["eom-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_of_month")
        .select("id, year, month, employee_id, reason")
        .order("year", { ascending: false })
        .order("month", { ascending: false })
        .limit(120);
      if (error) throw error;
      const list = (data ?? []) as Row[];
      const ids = Array.from(new Set(list.map((r) => r.employee_id)));
      const profiles: Record<string, Profile> = {};
      if (ids.length) {
        const { data: ps } = await supabase
          .from("profiles").select("id, full_name, departments(name)").in("id", ids);
        (ps ?? []).forEach((p: any) => (profiles[p.id] = p));
      }
      return { list, profiles };
    },
  });

  const employeesQ = useQuery({
    enabled: canManage,
    queryKey: ["eom-employees-pool"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, departments(name)")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as { id: string; full_name: string; departments: { name: string } | null }[];
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (row: Row) => {
      if (row.image_url) {
        await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
      }
      const { error } = await supabase.from("employee_of_month").delete().eq("id", row.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("העובד הוסר מרשימת עובדי החודש");
      qc.invalidateQueries({ queryKey: ["eom-manage"] });
      qc.invalidateQueries({ queryKey: ["eom-history"] });
      qc.invalidateQueries({ queryKey: ["eom", "current"] });
      setDeleting(null);
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  if (!me) return null;

  return (
    <div className="space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <div className="size-10 shrink-0 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Trophy className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">עובד החודש</h1>
            <p className="text-sm text-muted-foreground mt-1">בחירת עובדים מצטיינים והצגתם בלוח הבקרה</p>
          </div>
        </div>
        {canManage && (
          <Button onClick={() => setAddOpen(true)} className="shrink-0 gap-2">
            <Plus className="size-4" />
            הוספת עובד
          </Button>
        )}
      </header>

      <Card className="card-elevated p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label>חודש</Label>
            <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                {HEBREW_MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>שנה</Label>
            <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
              <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          {(monthQ.data?.list.length ?? 0) >= 2 ? "🏆 עובדי החודש" : "🏆 עובד החודש"}
          <span className="text-sm font-normal text-muted-foreground mr-2">
            ({HEBREW_MONTHS[month - 1]} {year})
          </span>
        </h2>
        {monthQ.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-primary" /></div>
        ) : (monthQ.data?.list.length ?? 0) === 0 ? (
          <Card className="card-elevated p-6 text-sm text-muted-foreground text-center">
            לא נבחרו עובדים לחודש זה.
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {monthQ.data!.list.map((r) => {
              const p = monthQ.data!.profiles[r.employee_id];
              const img = monthQ.data!.images[r.id] ?? monthQ.data!.avatars[r.employee_id] ?? null;
              return (
                <Card key={r.id} className="card-elevated p-5 text-center bg-gradient-to-b from-amber-50/60 to-background dark:from-amber-950/20 border-amber-200/60">
                  <div className="flex justify-center mb-3">
                    <div className="size-24 rounded-full overflow-hidden ring-4 ring-amber-300/60 bg-accent flex items-center justify-center text-3xl font-bold shadow-md">
                      {img ? (
                        <img src={img} alt={p?.full_name ?? ""} className="size-full object-cover" />
                      ) : (
                        <span>{(p?.full_name ?? "?").charAt(0)}</span>
                      )}
                    </div>
                  </div>
                  <Trophy className="size-5 text-amber-500 mx-auto mb-1" />
                  <h3 className="font-bold truncate">{p?.full_name ?? "—"}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {p?.departments?.name ?? "—"}{p?.job_title ? ` · ${p.job_title}` : ""}
                  </p>
                  {r.reason && <p className="text-sm mt-3 text-foreground/80 whitespace-pre-wrap break-words">{r.reason}</p>}
                  {canManage && (
                    <div className="flex gap-2 justify-center mt-4">
                      <Button size="sm" variant="outline" onClick={() => setEditing(r)} className="gap-1">
                        <Pencil className="size-3.5" />ערוך
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setDeleting(r)} className="gap-1 text-destructive hover:text-destructive">
                        <Trash2 className="size-3.5" />הסר
                      </Button>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
          <History className="size-5 text-primary" />
          היסטוריה
        </h2>
        <Card className="card-elevated divide-y">
          {(historyQ.data?.list ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground text-center">אין היסטוריה.</div>
          ) : (
            (historyQ.data?.list ?? []).map((r) => {
              const p = historyQ.data!.profiles[r.employee_id];
              return (
                <div key={r.id} className="flex items-center gap-3 p-3 text-sm">
                  <span className="text-muted-foreground tabular-nums w-28 shrink-0">
                    {HEBREW_MONTHS[r.month - 1]} {r.year}
                  </span>
                  <span className="font-medium truncate flex-1">{p?.full_name ?? "—"}</span>
                  <span className="text-xs text-muted-foreground truncate hidden sm:inline">
                    {p?.departments?.name ?? ""}
                  </span>
                </div>
              );
            })
          )}
        </Card>
      </section>

      {canManage && addOpen && (
        <EomEditDialog
          mode="create"
          year={year}
          month={month}
          existingIds={new Set((monthQ.data?.list ?? []).map((r) => r.employee_id))}
          employees={employeesQ.data ?? []}
          onClose={() => setAddOpen(false)}
        />
      )}
      {canManage && editing && (
        <EomEditDialog
          mode="edit"
          row={editing}
          year={editing.year}
          month={editing.month}
          existingIds={new Set()}
          employees={employeesQ.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>הסרת עובד החודש</AlertDialogTitle>
            <AlertDialogDescription>
              האם להסיר את העובד מרשימת עובדי החודש? לא ניתן לבטל פעולה זו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              הסר
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EomEditDialog({
  mode, row, year, month, existingIds, employees, onClose,
}: {
  mode: "create" | "edit";
  row?: Row;
  year: number;
  month: number;
  existingIds: Set<string>;
  employees: { id: string; full_name: string; departments: { name: string } | null }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const [employeeId, setEmployeeId] = useState<string>(row?.employee_id ?? "");
  const [reason, setReason] = useState<string>(row?.reason ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [saving, setSaving] = useState(false);

  const pool = useMemo(
    () => employees.filter((e) => mode === "edit" || !existingIds.has(e.id)),
    [employees, existingIds, mode],
  );

  async function uploadImageFor(rowId: string): Promise<string | null> {
    if (!file) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `${rowId}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("employee-of-month").upload(path, file, {
      upsert: true, contentType: file.type || undefined,
    });
    if (error) throw new Error(error.message);
    return path;
  }

  async function handleSave() {
    if (!employeeId) { toast.error("יש לבחור עובד"); return; }
    setSaving(true);
    try {
      if (mode === "create") {
        const { data: inserted, error } = await supabase
          .from("employee_of_month")
          .insert({ year, month, employee_id: employeeId, reason: reason.trim() || null, created_by: me?.id })
          .select("id").single();
        if (error) {
          if ((error as any).code === "23505") throw new Error("העובד כבר נבחר לחודש זה");
          throw error;
        }
        if (file) {
          const path = await uploadImageFor(inserted!.id);
          if (path) {
            await supabase.from("employee_of_month").update({ image_url: path }).eq("id", inserted!.id);
          }
        }
      } else if (row) {
        let imagePath: string | null | undefined = undefined;
        if (removeImage) {
          if (row.image_url) await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
          imagePath = null;
        }
        if (file) {
          if (row.image_url) await supabase.storage.from("employee-of-month").remove([row.image_url]).catch(() => {});
          imagePath = await uploadImageFor(row.id);
        }
        const update: { reason: string | null; image_url?: string | null } = { reason: reason.trim() || null };
        if (imagePath !== undefined) update.image_url = imagePath;
        const { error } = await supabase.from("employee_of_month").update(update).eq("id", row.id);
        if (error) throw error;
      }
      toast.success(mode === "create" ? "העובד נוסף לרשימת עובדי החודש" : "העדכון נשמר");
      qc.invalidateQueries({ queryKey: ["eom-manage"] });
      qc.invalidateQueries({ queryKey: ["eom-history"] });
      qc.invalidateQueries({ queryKey: ["eom", "current"] });
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "שגיאה בשמירה");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "הוספת עובד החודש" : "עריכת עובד החודש"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label>עובד</Label>
            <Select value={employeeId} onValueChange={setEmployeeId} disabled={mode === "edit"}>
              <SelectTrigger><SelectValue placeholder="בחר עובד" /></SelectTrigger>
              <SelectContent className="max-h-72">
                {pool.length === 0 ? (
                  <div className="p-3 text-sm text-muted-foreground text-center">
                    כל העובדים כבר נבחרו לחודש זה
                  </div>
                ) : pool.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name}{e.departments?.name ? ` · ${e.departments.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>סיבת הבחירה (אופציונלי)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="לדוגמה: שירות מצוין ללקוחות, יוזמה אישית, מקצועיות..."
              rows={3}
              maxLength={500}
            />
          </div>
          <div className="space-y-1">
            <Label>תמונה לעובד החודש (אופציונלי)</Label>
            <div className="flex items-center gap-2">
              <Input
                type="file"
                accept="image/*"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRemoveImage(false); }}
              />
              {mode === "edit" && row?.image_url && !file && !removeImage && (
                <Button type="button" size="sm" variant="outline" onClick={() => setRemoveImage(true)} className="gap-1 shrink-0">
                  <ImageOff className="size-4" />
                  הסר
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              אם לא תועלה תמונה, תוצג תמונת הפרופיל של העובד.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>ביטול</Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
