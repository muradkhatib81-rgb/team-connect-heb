import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import { toast } from "sonner";
import {
  Coffee,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/break-settings")({
  component: BreakSettingsPage,
});

interface BreakRow {
  id: string;
  name: string;
  duration_minutes: number;
  order_index: number;
  is_active: boolean;
}

export function BreakSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");

  const permQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["my-break-manage-perm", me?.id],
    queryFn: async () => {
      if (isMainAdmin) return true;
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks")
        .eq("user_id", me!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_breaks;
    },
  });

  const canManage = !!permQ.data;

  const listQ = useQuery({
    queryKey: ["break-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_settings")
        .select("id, name, duration_minutes, order_index, is_active")
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BreakRow[];
    },
  });

  useEffect(() => {
    const ch = supabase
      .channel("break-settings-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_settings" },
        () => qc.invalidateQueries({ queryKey: ["break-settings"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const [editing, setEditing] = useState<BreakRow | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<BreakRow | null>(null);

  const saveMut = useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      duration_minutes: number;
      order_index?: number;
    }) => {
      if (input.id) {
        const { error } = await supabase
          .from("break_settings")
          .update({
            name: input.name,
            duration_minutes: input.duration_minutes,
          })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const nextOrder =
          (listQ.data?.[listQ.data.length - 1]?.order_index ?? 0) + 1;
        const { error } = await supabase.from("break_settings").insert({
          name: input.name,
          duration_minutes: input.duration_minutes,
          order_index: nextOrder,
          created_by: me!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("נשמר");
      setEditing(null);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["break-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("break_settings").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("נמחק");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["break-settings"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const reorderMut = useMutation({
    mutationFn: async (next: BreakRow[]) => {
      // Two-phase to avoid clashing with any potential unique constraints; simple updates.
      for (let i = 0; i < next.length; i++) {
        const row = next[i];
        const newOrder = i + 1;
        if (row.order_index === newOrder) continue;
        const { error } = await supabase
          .from("break_settings")
          .update({ order_index: newOrder })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["break-settings"] }),
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  function move(idx: number, dir: -1 | 1) {
    const arr = [...(listQ.data ?? [])];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderMut.mutate(arr);
  }

  if (!me) return null;

  if (!permQ.isLoading && !canManage) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">
          רק מנהל ראשי או משתמש עם הרשאת "ניהול הפסקות" יכול לגשת למסך זה.
        </p>
      </Card>
    );
  }

  const rows = listQ.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Coffee className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">הגדרות הפסקות</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ניהול גמיש של סוגי ההפסקות במערכת. השינויים חלים מיד על כל
              המשתמשים.
            </p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> הפסקה חדשה
            </Button>
          </DialogTrigger>
          <BreakDialog
            key={createOpen ? "create" : "create-closed"}
            title="יצירת הפסקה"
            saving={saveMut.isPending}
            onSubmit={(v) => saveMut.mutate(v)}
          />
        </Dialog>
      </header>

      {listQ.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : rows.length === 0 ? (
        <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
          עדיין לא הוגדרו הפסקות. לחצו על "הפסקה חדשה" כדי להתחיל.
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r, idx) => (
            <Card
              key={r.id}
              className="card-elevated p-4 flex items-center gap-3"
            >
              <div className="size-9 rounded-full bg-accent text-accent-foreground flex items-center justify-center font-semibold shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{r.name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.duration_minutes} דקות
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="העלאה למעלה"
                  disabled={idx === 0 || reorderMut.isPending}
                  onClick={() => move(idx, -1)}
                >
                  <ArrowUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="הורדה למטה"
                  disabled={idx === rows.length - 1 || reorderMut.isPending}
                  onClick={() => move(idx, 1)}
                >
                  <ArrowDown className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="עריכה"
                  onClick={() => setEditing(r)}
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="מחיקה"
                  onClick={() => setDeleteTarget(r)}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <BreakDialog
            key={editing.id}
            title="עריכת הפסקה"
            initial={editing}
            saving={saveMut.isPending}
            onSubmit={(v) =>
              saveMut.mutate({ ...v, id: editing.id })
            }
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת הפסקה</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק את "{deleteTarget?.name}"? פעולה זו תחול מיד על כל
              המשתמשים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              disabled={deleteMut.isPending}
            >
              מחיקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BreakDialog({
  title,
  initial,
  saving,
  onSubmit,
}: {
  title: string;
  initial?: { name: string; duration_minutes: number };
  saving: boolean;
  onSubmit: (v: { name: string; duration_minutes: number }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [duration, setDuration] = useState<string>(
    initial?.duration_minutes ? String(initial.duration_minutes) : "",
  );

  function submit() {
    const n = name.trim();
    const d = Number(duration);
    if (!n) {
      toast.error("יש להזין שם הפסקה");
      return;
    }
    if (!Number.isFinite(d) || d <= 0 || d > 480) {
      toast.error("משך ההפסקה חייב להיות בין 1 ל-480 דקות");
      return;
    }
    onSubmit({ name: n, duration_minutes: Math.round(d) });
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="bk-name">שם ההפסקה</Label>
          <Input
            id="bk-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: הפסקה ראשונה"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bk-dur">משך ההפסקה (בדקות)</Label>
          <Input
            id="bk-dur"
            type="number"
            min={1}
            max={480}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="לדוגמה: 15"
          />
        </div>
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={saving} className="gap-2">
          {saving && <Loader2 className="size-4 animate-spin" />} שמירה
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
