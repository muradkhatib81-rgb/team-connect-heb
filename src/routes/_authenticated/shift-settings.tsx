import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useShiftDefinitions, type ShiftDef } from "@/lib/use-shift-definitions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Clock,
  Plus,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
  Loader2,
  Lock,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/shift-settings")({
  component: ShiftSettingsPage,
});

const PRESET_COLORS = [
  "#f59e0b", "#0ea5e9", "#10b981", "#6366f1", "#ef4444",
  "#a855f7", "#14b8a6", "#f43f5e", "#64748b", "#0f172a",
];

function slugifyCode(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05FF]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
  return base || `shift_${Date.now()}`;
}

function ShiftSettingsPage() {
  const qc = useQueryClient();
  const { data: me } = useAuth();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isBranchManager = !!me?.roles.includes("branch_manager");

  const permQ = useQuery({
    enabled: !!me?.id && !isMainAdmin && !isBranchManager,
    queryKey: ["my-shift-manage-perm", me?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_schedule, can_create_schedule, can_edit_schedule")
        .eq("user_id", me!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_schedule || !!(data as any)?.can_create_schedule || !!(data as any)?.can_edit_schedule;
    },
  });

  const listQ = useShiftDefinitions();
  const rows = listQ.all;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ShiftDef | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ShiftDef | null>(null);

  const saveMut = useMutation({
    mutationFn: async (input: {
      id?: string;
      name: string;
      start_time: string | null;
      end_time: string | null;
      color: string;
      is_active: boolean;
    }) => {
      if (input.id) {
        const { error } = await supabase
          .from("shift_definitions")
          .update({
            name: input.name,
            start_time: input.start_time,
            end_time: input.end_time,
            color: input.color,
            is_active: input.is_active,
          })
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const nextOrder = (rows[rows.length - 1]?.sort_order ?? 0) + 1;
        const code = slugifyCode(input.name);
        // Ensure unique code
        const existing = rows.find((r) => r.code === code);
        const finalCode = existing ? `${code}_${Date.now()}` : code;
        const { error } = await supabase.from("shift_definitions").insert({
          code: finalCode,
          name: input.name,
          start_time: input.start_time,
          end_time: input.end_time,
          color: input.color,
          sort_order: nextOrder,
          is_active: input.is_active,
          is_system: false,
          created_by: me!.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("נשמר");
      setEditing(null);
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["shift-definitions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      // Block delete if shift used by any schedule_shifts row
      const target = rows.find((r) => r.id === id);
      if (target) {
        const { count } = await supabase
          .from("schedule_shifts")
          .select("id", { count: "exact", head: true })
          .eq("shift", target.code);
        if ((count ?? 0) > 0) {
          throw new Error(
            `לא ניתן למחוק — המשמרת בשימוש ב-${count} שיבוצי עובדים. ניתן להשבית אותה במקום.`,
          );
        }
      }
      const { error } = await supabase.from("shift_definitions").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("נמחק");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["shift-definitions"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const reorderMut = useMutation({
    mutationFn: async (next: ShiftDef[]) => {
      for (let i = 0; i < next.length; i++) {
        const row = next[i];
        const newOrder = i + 1;
        if (row.sort_order === newOrder) continue;
        const { error } = await supabase
          .from("shift_definitions")
          .update({ sort_order: newOrder })
          .eq("id", row.id);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  function move(idx: number, dir: -1 | 1) {
    const arr = [...rows];
    const j = idx + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    reorderMut.mutate(arr);
  }

  if (!me) return null;
  // Quick canManage check (RLS will enforce server-side anyway)
  const canManage = isMainAdmin || isBranchManager || !!permQ.data;

  if (!canManage) {
    return (
      <Card className="card-elevated p-8 text-center">
        <h2 className="text-lg font-semibold">אין הרשאה</h2>
        <p className="text-sm text-muted-foreground mt-2">
          רק מנהל ראשי או משתמש עם הרשאת ניהול סידורי עבודה יכול לגשת למסך זה.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Clock className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold">הגדרות משמרות</h1>
            <p className="text-sm text-muted-foreground mt-1">
              ניהול גמיש של סוגי המשמרות במערכת. השינויים חלים מיד על סידורי
              העבודה ועל כל המסכים.
            </p>
          </div>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="size-4" /> משמרת חדשה
            </Button>
          </DialogTrigger>
          <ShiftDialog
            key={createOpen ? "create" : "create-closed"}
            title="יצירת משמרת"
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
          עדיין לא הוגדרו משמרות. לחצו על "משמרת חדשה" כדי להתחיל.
        </Card>
      ) : (
        <div className="grid gap-3">
          {rows.map((r, idx) => (
            <Card
              key={r.id}
              className="card-elevated p-4 flex items-center gap-3"
            >
              <div
                className="size-9 rounded-full flex items-center justify-center font-semibold shrink-0 text-white"
                style={{ backgroundColor: r.color }}
              >
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium truncate">{r.name}</p>
                  {r.is_system && (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="size-3" /> מערכת
                    </Badge>
                  )}
                  {!r.is_active && (
                    <Badge variant="secondary">לא פעיל</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.start_time && r.end_time
                    ? `${r.start_time.slice(0, 5)} – ${r.end_time.slice(0, 5)}`
                    : "ללא שעות (לדוגמה: חופש)"}
                  {" · "}קוד: {r.code}
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
                  disabled={r.is_system}
                  title={r.is_system ? "לא ניתן למחוק משמרת מערכת" : undefined}
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
          <ShiftDialog
            key={editing.id}
            title="עריכת משמרת"
            initial={editing}
            saving={saveMut.isPending}
            onSubmit={(v) => saveMut.mutate({ ...v, id: editing.id })}
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת משמרת</AlertDialogTitle>
            <AlertDialogDescription>
              האם למחוק את "{deleteTarget?.name}"? אם המשמרת בשימוש בסידור עבודה
              קיים — המחיקה תיחסם והמערכת תציע להשבית אותה במקום.
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

function ShiftDialog({
  title,
  initial,
  saving,
  onSubmit,
}: {
  title: string;
  initial?: Partial<ShiftDef>;
  saving: boolean;
  onSubmit: (v: {
    name: string;
    start_time: string | null;
    end_time: string | null;
    color: string;
    is_active: boolean;
  }) => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [startTime, setStartTime] = useState(initial?.start_time?.slice(0, 5) ?? "");
  const [endTime, setEndTime] = useState(initial?.end_time?.slice(0, 5) ?? "");
  const [color, setColor] = useState(initial?.color ?? PRESET_COLORS[0]);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [noTimes, setNoTimes] = useState(!initial?.start_time && !initial?.end_time);

  function submit() {
    const n = name.trim();
    if (!n) {
      toast.error("יש להזין שם משמרת");
      return;
    }
    if (!noTimes) {
      if (!startTime || !endTime) {
        toast.error("יש להזין שעת התחלה ושעת סיום (או לסמן 'ללא שעות')");
        return;
      }
    }
    onSubmit({
      name: n,
      start_time: noTimes ? null : `${startTime}:00`,
      end_time: noTimes ? null : `${endTime}:00`,
      color,
      is_active: isActive,
    });
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="sh-name">שם המשמרת</Label>
          <Input
            id="sh-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="לדוגמה: בוקר, לילה, אמצע"
            autoComplete="off"
          />
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch
            id="sh-notimes"
            checked={noTimes}
            onCheckedChange={setNoTimes}
          />
          <Label htmlFor="sh-notimes" className="text-sm">
            ללא שעות (לדוגמה: חופש)
          </Label>
        </div>

        {!noTimes && (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sh-start">שעת התחלה</Label>
              <Input
                id="sh-start"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sh-end">שעת סיום</Label>
              <Input
                id="sh-end"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>צבע המשמרת</Label>
          <div className="flex items-center gap-2 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`צבע ${c}`}
                onClick={() => setColor(c)}
                className={`size-8 rounded-full border-2 transition ${
                  color === c ? "border-foreground scale-110" : "border-transparent"
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
            <Input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="size-8 p-0 border-2 cursor-pointer"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <Switch
            id="sh-active"
            checked={isActive}
            onCheckedChange={setIsActive}
          />
          <Label htmlFor="sh-active" className="text-sm">
            פעיל (יוצג בסידורי עבודה)
          </Label>
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
