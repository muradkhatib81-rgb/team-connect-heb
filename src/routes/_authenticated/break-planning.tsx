import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
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
  DialogFooter,
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
import { toast } from "sonner";
import {
  CalendarClock,
  Coffee,
  Loader2,
  Pencil,
  Plus,
  Send,
  Trash2,
  ArrowRight,
} from "lucide-react";
import {
  BREAK_STATUS_LABEL,
  BREAK_STATUS_TONE,
  BreakLiveTimer,
  fmtBreakTime,
  isBreakEditable,
  isoFromLocalTime,
  sortBreaksByStart,
  toLocalTime,
  todayJerusalemDate,
} from "@/lib/break-workflow";

export const Route = createFileRoute("/_authenticated/break-planning")({
  component: BreakPlanningPage,
});

interface BreakSetting {
  id: string;
  name: string;
  duration_minutes: number;
}

interface BreakRequestRow {
  id: string;
  break_setting_id: string;
  planned_start: string | null;
  requested_at: string;
  duration_minutes: number;
  planned_duration: number | null;
  status: string;
  note: string | null;
  ends_at: string | null;
}

interface DraftBreak {
  key: string;
  settingId: string;
  timeStr: string;
  note: string;
}

function BreakPlanningPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const today = todayJerusalemDate();

  const settingsQ = useQuery({
    enabled: !!me,
    queryKey: ["break-settings-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_settings")
        .select("id, name, duration_minutes")
        .eq("is_active", true)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BreakSetting[];
    },
  });

  const todayQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["my-breaks-today", me?.id, today],
    queryFn: async () => {
      const dayStart = `${today}T00:00:00+03:00`;
      const dayEnd = `${today}T23:59:59+03:00`;
      const { data, error } = await supabase
        .from("break_requests")
        .select("*")
        .eq("user_id", me!.id)
        .gte("requested_at", dayStart)
        .lte("requested_at", dayEnd)
        .order("requested_at", { ascending: true });
      if (error) throw error;
      return sortBreaksByStart((data ?? []) as BreakRequestRow[]);
    },
  });

  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel(`break-planning-rt-${me.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_requests", filter: `user_id=eq.${me.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
          qc.invalidateQueries({ queryKey: ["my-break-requests"] });
          qc.invalidateQueries({ queryKey: ["my-active-break"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc, me?.id]);

  const policyQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["break-policy-effective", me?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_break_policy");
      if (error) throw error;
      return data as { requires_approval?: boolean } | null;
    },
  });

  const [drafts, setDrafts] = useState<DraftBreak[]>([]);
  const [editTarget, setEditTarget] = useState<BreakRequestRow | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BreakRequestRow | null>(null);

  const addDraft = () => {
    const settings = settingsQ.data ?? [];
    setDrafts((d) => [
      ...d,
      {
        key: String(Date.now()) + Math.random(),
        settingId: settings[0]?.id ?? "",
        timeStr: toLocalTime(new Date().toISOString()),
        note: "",
      },
    ]);
  };

  const submitDraftsMut = useMutation({
    mutationFn: async () => {
      if (!drafts.length) throw new Error("יש להוסיף לפחות הפסקה אחת");
      for (const d of drafts) {
        if (!d.settingId) throw new Error("יש לבחור סוג הפסקה לכל שורה");
        if (!d.timeStr) throw new Error("יש לבחור שעה לכל הפסקה");
        const setting = settingsQ.data?.find((s) => s.id === d.settingId);
        if (!setting) throw new Error("סוג הפסקה לא קיים");
        const requestedAt = isoFromLocalTime(d.timeStr);
        const { error } = await supabase.from("break_requests").insert({
          user_id: me!.id,
          department_id: me!.department_id ?? null,
          break_setting_id: d.settingId,
          duration_minutes: setting.duration_minutes,
          planned_duration: setting.duration_minutes,
          requested_at: requestedAt,
          planned_start: requestedAt,
          note: d.note.trim() || null,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(
        policyQ.data?.requires_approval
          ? "כל בקשות ההפסקה נשלחו לאישור"
          : "כל ההפסקות נקבעו בהצלחה",
      );
      setDrafts([]);
      qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשליחה"),
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("cancel_break_request", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ההפסקה בוטלה");
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בביטול"),
  });

  const rows = todayQ.data ?? [];
  const activeBreak = rows.find((r) => r.status === "active");

  if (!me) return null;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3 flex-wrap">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CalendarClock className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">תכנון הפסקות</h1>
          <p className="text-sm text-muted-foreground mt-1">
            תכנון כל ההפסקות למשמרת — ניתן להוסיף מספר הפסקות בבת אחת.
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/breaks" className="gap-1">
            <ArrowRight className="size-4" />
            חזרה להפסקה
          </Link>
        </Button>
      </header>

      {activeBreak && (
        <Card className="card-elevated p-4 border-green-500/50 bg-green-50/50 dark:bg-green-950/20">
          <div className="flex items-center gap-3">
            <Coffee className="size-5 text-green-600" />
            <div className="flex-1">
              <p className="font-medium">הפסקה פעילה כעת</p>
              {activeBreak.ends_at && <BreakLiveTimer endsAt={activeBreak.ends_at} />}
            </div>
            <Badge>פעילה</Badge>
          </div>
        </Card>
      )}

      <Card className="card-elevated p-5 space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">הפסקות היום</h2>
          <span className="text-xs text-muted-foreground">{today}</span>
        </div>

        {todayQ.isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            אין הפסקות מתוכננות להיום.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-lg border">
            {rows.map((r) => {
              const setting = settingsQ.data?.find((s) => s.id === r.break_setting_id);
              const startIso = r.planned_start ?? r.requested_at;
              const dur = r.planned_duration ?? r.duration_minutes;
              return (
                <div key={r.id} className="flex items-center gap-3 p-4 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <p className="font-mono text-lg font-semibold">{fmtBreakTime(startIso)}</p>
                    <p className="text-sm text-muted-foreground">
                      {dur} דקות · {setting?.name ?? "הפסקה"}
                    </p>
                    {r.status === "active" && r.ends_at && <BreakLiveTimer endsAt={r.ends_at} />}
                  </div>
                  <Badge variant={BREAK_STATUS_TONE[r.status] ?? "secondary"}>
                    {BREAK_STATUS_LABEL[r.status] ?? r.status}
                  </Badge>
                  {isBreakEditable(r.status) && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditTarget(r)}>
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setCancelTarget(r)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="card-elevated p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">הוספת הפסקות חדשות</h2>
          <Button size="sm" variant="outline" onClick={addDraft} className="gap-1">
            <Plus className="size-4" /> הוסף שורה
          </Button>
        </div>

        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            לחץ/י על &quot;הוסף שורה&quot; כדי לתכנן הפסקות נוספות למשמרת.
          </p>
        ) : (
          <div className="space-y-3">
            {drafts.map((d, idx) => (
              <div key={d.key} className="grid sm:grid-cols-4 gap-3 items-end border rounded-lg p-3">
                <div className="space-y-1.5">
                  <Label>סוג הפסקה</Label>
                  <Select
                    value={d.settingId}
                    onValueChange={(v) =>
                      setDrafts((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, settingId: v } : x)),
                      )
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="בחר/י" />
                    </SelectTrigger>
                    <SelectContent>
                      {(settingsQ.data ?? []).map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.duration_minutes} דק׳
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>שעה</Label>
                  <Input
                    type="time"
                    value={d.timeStr}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, timeStr: e.target.value } : x)),
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label>הערה</Label>
                  <Input
                    value={d.note}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, note: e.target.value } : x)),
                      )
                    }
                    placeholder="אופציונלי"
                  />
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-destructive sm:col-span-4 sm:justify-self-end"
                  onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== idx))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              className="gap-2 w-full sm:w-auto"
              onClick={() => submitDraftsMut.mutate()}
              disabled={submitDraftsMut.isPending}
            >
              {submitDraftsMut.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
              שלח {drafts.length} הפסקות
            </Button>
          </div>
        )}
      </Card>

      {editTarget && (
        <EditBreakDialog
          row={editTarget}
          settings={settingsQ.data ?? []}
          onClose={() => setEditTarget(null)}
        />
      )}

      <AlertDialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ביטול הפסקה</AlertDialogTitle>
            <AlertDialogDescription>
              ההפסקה תסומן כ&quot;בוטל ע״י עובד&quot; ותישאר בהיסטוריה. לא ניתן לשחזר.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>חזרה</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => cancelTarget && cancelMut.mutate(cancelTarget.id)}
              disabled={cancelMut.isPending}
            >
              בטל הפסקה
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EditBreakDialog({
  row,
  settings,
  onClose,
}: {
  row: BreakRequestRow;
  settings: BreakSetting[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const startIso = row.planned_start ?? row.requested_at;
  const [timeStr, setTimeStr] = useState(toLocalTime(startIso));
  const [settingId, setSettingId] = useState(row.break_setting_id);

  const saveMut = useMutation({
    mutationFn: async () => {
      const setting = settings.find((s) => s.id === settingId);
      const newStart = isoFromLocalTime(timeStr);
      const { error } = await (supabase as any).rpc("reschedule_break_request", {
        _id: row.id,
        _new_start: newStart,
        _new_duration: setting?.duration_minutes ?? row.duration_minutes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("ההפסקה עודכנה");
      qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
      onClose();
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בעדכון"),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>עריכת הפסקה</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>סוג הפסקה</Label>
            <Select value={settingId} onValueChange={setSettingId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {settings.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name} · {s.duration_minutes} דק׳
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>שעה</Label>
            <Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="gap-2">
            {saveMut.isPending && <Loader2 className="size-4 animate-spin" />}
            שמור
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
