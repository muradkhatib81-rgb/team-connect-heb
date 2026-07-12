import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Coffee,
  Loader2,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Send,
  Pencil,
  Trash2,
} from "lucide-react";
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

export const Route = createFileRoute("/_authenticated/breaks")({
  component: BreaksPage,
});

interface BreakSetting {
  id: string;
  name: string;
  duration_minutes: number;
  order_index: number;
  is_active: boolean;
}

interface BreakRequest {
  id: string;
  user_id: string;
  department_id: string | null;
  break_setting_id: string;
  requested_at: string;
  approved_at_time: string | null;
  duration_minutes: number;
  note: string | null;
  status: string;
  approved_by: string | null;
  approval_decided_at: string | null;
  started_at: string | null;
  ends_at: string | null;
  completed_at: string | null;
  created_at: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "ממתינה לאישור",
  approved: "אושרה",
  active: "בהפסקה",
  completed: "הסתיימה",
  cancelled: "בוטלה",
};
const STATUS_TONE: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  approved: "default",
  active: "default",
  completed: "outline",
  cancelled: "destructive",
};

function fmtTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

function isoFromLocalTime(timeStr: string): string {
  // timeStr "HH:MM" → today's date at that local time, ISO
  const [hh, mm] = timeStr.split(":").map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return d.toISOString();
}

function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function BreaksPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isBranchOrAssistant =
    !!me?.roles.includes("branch_manager") || !!me?.roles.includes("assistant_manager");

  const permQ = useQuery({
    enabled: !!me?.id && !isMainAdmin,
    queryKey: ["my-break-manage-perm", me?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_manage_breaks")
        .eq("user_id", me!.id)
        .maybeSingle();
      return !!(data as any)?.can_manage_breaks;
    },
  });
  const isBreaksManager =
    isMainAdmin || isBranchOrAssistant || !!permQ.data;

  // Can this user request a break? Combines job-title flag + system break policy.
  const canRequestQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["can-request-break", me?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("can_user_request_break", {
        _user_id: me!.id,
      });
      if (error) return true;
      return data !== false;
    },
  });
  const canRequestBreak = canRequestQ.data !== false;

  // Managers are also employees: they may request their own break here.
  // The dedicated /breaks-admin screen remains for approval/management.

  const settingsQ = useQuery({
    enabled: !!me,
    queryKey: ["break-settings-active"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_settings")
        .select("id, name, duration_minutes, order_index, is_active")
        .eq("is_active", true)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return (data ?? []) as BreakSetting[];
    },
  });

  const myReqQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["my-break-requests", me?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("*")
        .eq("user_id", me!.id)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return (data ?? []) as BreakRequest[];
    },
  });

  // Realtime — refresh own requests and active break settings
  useEffect(() => {
    const ch = supabase
      .channel("break-requests-self-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_requests" },
        () => {
          qc.invalidateQueries({ queryKey: ["my-break-requests"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_settings" },
        () => qc.invalidateQueries({ queryKey: ["break-settings-active"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "job_titles" },
        () => qc.invalidateQueries({ queryKey: ["can-request-break"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "break_policy" },
        () => {
          qc.invalidateQueries({ queryKey: ["can-request-break"] });
          qc.invalidateQueries({ queryKey: ["break-policy-effective"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  const policyQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["break-policy-effective", me?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_break_policy");
      if (error) throw error;
      return data as { requires_approval?: boolean } | null;
    },
  });
  const requiresApproval = policyQ.data?.requires_approval !== false;

  // ---- Submit form
  const [settingId, setSettingId] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [note, setNote] = useState("");

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!settingId) throw new Error("יש לבחור סוג הפסקה");
      if (requiresApproval && !timeStr) throw new Error("יש לבחור שעה");
      const setting = settingsQ.data?.find((s) => s.id === settingId);
      if (!setting) throw new Error("סוג הפסקה לא קיים");
      const now = new Date();
      const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const { data: existing, error: exErr } = await supabase
        .from("break_requests")
        .select("id, status")
        .eq("user_id", me!.id)
        .eq("break_setting_id", settingId)
        .gte("created_at", dayStart.toISOString())
        .lt("created_at", dayEnd.toISOString())
        .limit(1);
      if (exErr) throw exErr;
      if ((existing ?? []).length > 0) {
        throw new Error("כבר שלחת בקשה עבור סוג הפסקה זה היום.");
      }
      const requestedAt = requiresApproval ? isoFromLocalTime(timeStr) : now.toISOString();
      const approvalPatch = requiresApproval
        ? { status: "pending" }
        : {
            status: "active",
            approved_at_time: requestedAt,
            approved_by: me!.id,
            approval_decided_at: now.toISOString(),
            started_at: requestedAt,
            ends_at: new Date(now.getTime() + setting.duration_minutes * 60_000).toISOString(),
          };
      const { error } = await supabase.from("break_requests").insert({
        user_id: me!.id,
        department_id: me!.department_id ?? null,
        break_setting_id: settingId,
        duration_minutes: setting.duration_minutes,
        requested_at: requestedAt,
        note: note.trim() || null,
        ...approvalPatch,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(requiresApproval ? "בקשת ההפסקה נשלחה" : "ההפסקה החלה");
      setSettingId("");
      setTimeStr("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה בשליחה"),
  });

  if (!me) return null;



  const myReqs = myReqQ.data ?? [];

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Coffee className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">הפסקה</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {requiresApproval
              ? "הגשת בקשת הפסקה וצפייה בסטטוס. השעה המאושרת היא הקובעת."
              : "הגשת הפסקה ללא צורך באישור מנהל. השעה שבחרת תאושר אוטומטית."}
          </p>
        </div>
      </header>

      <Tabs defaultValue={canRequestBreak ? "request" : "mine"} className="space-y-4">
        <TabsList>
          {canRequestBreak && <TabsTrigger value="request">בקשת הפסקה</TabsTrigger>}
          <TabsTrigger value="mine">הבקשות שלי</TabsTrigger>
        </TabsList>

        {canRequestBreak && (
          <TabsContent value="request">
            <Card className="card-elevated p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>סוג הפסקה</Label>
                  <Select value={settingId} onValueChange={setSettingId}>
                    <SelectTrigger>
                      <SelectValue placeholder="בחר/י סוג הפסקה" />
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
                  <Label htmlFor="brk-time">שעה מבוקשת</Label>
                  <Input
                    id="brk-time"
                    type="time"
                    value={timeStr}
                    onChange={(e) => setTimeStr(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brk-note">הערה (אופציונלי)</Label>
                <Textarea
                  id="brk-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="הערה למנהל"
                  rows={3}
                />
              </div>
              <Button
                className="gap-2"
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending}
              >
                {submitMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {requiresApproval ? "שלח בקשה" : "התחל ללא אישור"}
              </Button>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="mine">
          {myReqQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : myReqs.length === 0 ? (
            <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
              עוד לא הגשת בקשת הפסקה.
            </Card>
          ) : (
            <div className="grid gap-3">
              {myReqs.map((r) => {
                const setting = settingsQ.data?.find((s) => s.id === r.break_setting_id);
                const showTime = r.approved_at_time ?? r.requested_at;
                return (
                  <Card key={r.id} className="card-elevated p-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {setting?.name ?? "הפסקה"} · {r.duration_minutes} דק׳
                      </p>
                      <p className="text-xs text-muted-foreground">
                        שעה: {fmtTime(showTime)}
                        {r.status === "active" && r.ends_at ? (
                          <> · מסתיים ב־{fmtTime(r.ends_at)}</>
                        ) : null}
                      </p>
                      {r.note && (
                        <p className="text-xs text-muted-foreground mt-1">הערה: {r.note}</p>
                      )}
                    </div>
                    <Badge variant={STATUS_TONE[r.status] ?? "secondary"}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </Badge>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Manager-only approval list — used by /breaks-admin
export function ApproveList({
  all,

  loading,
  settings,
  profiles,
  departments,
  me,
}: {
  all: BreakRequest[];
  loading: boolean;
  settings: BreakSetting[];
  profiles: { id: string; full_name: string; department_id: string | null }[];
  departments: { id: string; name: string; manager_id: string | null }[];
  me: string;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BreakRequest | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BreakRequest | null>(null);

  const pending = all.filter((r) => r.status === "pending");

  const profOf = (uid: string) => profiles.find((p) => p.id === uid);
  const deptName = (id: string | null) =>
    id ? departments.find((d) => d.id === id)?.name ?? "—" : "—";
  const isDeptMgr = (uid: string, deptId: string | null) =>
    !!deptId && departments.some((d) => d.id === deptId && d.manager_id === uid);

  // overlap analysis: for a target time, who else has approved/pending in same hour-bucket (rounded to minute)
  function overlapping(target: string, excludeId: string) {
    const t = new Date(target).getTime();
    return all.filter((r) => {
      if (r.id === excludeId) return false;
      if (r.status === "cancelled" || r.status === "completed") return false;
      const ref = r.approved_at_time ?? r.requested_at;
      const rt = new Date(ref).getTime();
      return Math.abs(rt - t) <= 60_000; // within 1 minute
    });
  }

  const approveMut = useMutation({
    mutationFn: async (input: { id: string; approvedTimeIso: string }) => {
      const { error } = await supabase
        .from("break_requests")
        .update({
          status: "approved",
          approved_at_time: input.approvedTimeIso,
          approved_by: me,
          approval_decided_at: new Date().toISOString(),
        })
        .eq("id", input.id);
      if (error) throw error;
      // Notify the employee
      const req = all.find((r) => r.id === input.id);
      if (req) {
        await supabase.from("schedule_notifications").insert({
          user_id: req.user_id,
          schedule_id: null,
          message: `בקשת ההפסקה שלך אושרה. שעת ההפסקה עודכנה ל־${fmtTime(input.approvedTimeIso)}.`,
        });
      }
    },
    onSuccess: () => {
      toast.success("הבקשה אושרה");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("break_requests").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("הבקשה נמחקה");
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה במחיקה"),
  });

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }
  if (pending.length === 0) {
    return (
      <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
        אין בקשות הפסקה ממתינות.
      </Card>
    );
  }

  return (
    <>
      <div className="grid gap-3">
        {pending.map((r) => {
          const setting = settings.find((s) => s.id === r.break_setting_id);
          const prof = profOf(r.user_id);
          const overlaps = overlapping(r.requested_at, r.id);
          const warn = overlaps.length >= 4;
          return (
            <Card key={r.id} className="card-elevated p-4 space-y-2">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">
                    {prof?.full_name ?? "—"} · {deptName(prof?.department_id ?? null)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {setting?.name ?? "הפסקה"} · {r.duration_minutes} דק׳ · ביקש/ה לשעה{" "}
                    {fmtTime(r.requested_at)}
                  </p>
                  {r.note && (
                    <p className="text-xs text-muted-foreground mt-1">הערה: {r.note}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setEditing(r)}
                  >
                    <Pencil className="size-4" /> שנה שעה
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() =>
                      approveMut.mutate({ id: r.id, approvedTimeIso: r.requested_at })
                    }
                    disabled={approveMut.isPending}
                  >
                    <CheckCircle2 className="size-4" /> אישור
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(r)}
                  >
                    <Trash2 className="size-4" /> מחיקה
                  </Button>
                </div>
              </div>

              {overlaps.length > 0 && (
                <div
                  className={
                    "rounded-md border p-2 text-xs " +
                    (warn
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-muted bg-muted/40 text-muted-foreground")
                  }
                >
                  <div className="flex items-center gap-1 font-medium">
                    {warn && <AlertTriangle className="size-3.5" />}
                    {warn
                      ? "שים לב: יותר מ-4 עובדים כבר ביקשו הפסקה בשעה זו. מומלץ לבדוק אם ניתן לאשר את הבקשה או לבחור שעה אחרת."
                      : `${overlaps.length} עובדים נוספים באותה שעה:`}
                  </div>
                  <ul className="mt-1 list-disc pr-4 space-y-0.5">
                    {overlaps.map((o) => {
                      const p = profOf(o.user_id);
                      const mgr = isDeptMgr(o.user_id, p?.department_id ?? null);
                      return (
                        <li key={o.id}>
                          {p?.full_name ?? "—"} · {deptName(p?.department_id ?? null)}
                          {mgr && " · אחראי מחלקה"}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditTimeDialog
            req={editing}
            saving={approveMut.isPending}
            onApprove={(iso) => approveMut.mutate({ id: editing.id, approvedTimeIso: iso })}
          />
        )}
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת בקשת הפסקה</AlertDialogTitle>
            <AlertDialogDescription>
              הבקשה תוסר מיד אצל המנהל ואצל העובד. לא ניתן לשחזר.
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
    </>
  );
}

function EditTimeDialog({
  req,
  saving,
  onApprove,
}: {
  req: BreakRequest;
  saving: boolean;
  onApprove: (iso: string) => void;
}) {
  const initial = req.approved_at_time ?? req.requested_at;
  const [t, setT] = useState(toLocalTime(initial));
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>שינוי שעת הפסקה ואישור</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="bk-newtime">שעה חדשה</Label>
          <Input
            id="bk-newtime"
            type="time"
            value={t}
            onChange={(e) => setT(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          השעה שתאושר תוצג לעובד כשעת ההפסקה.
        </p>
      </div>
      <DialogFooter>
        <Button
          onClick={() => onApprove(isoFromLocalTime(t))}
          disabled={saving}
          className="gap-2"
        >
          {saving && <Loader2 className="size-4 animate-spin" />}
          <CheckCircle2 className="size-4" />
          אישור עם שעה זו
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
