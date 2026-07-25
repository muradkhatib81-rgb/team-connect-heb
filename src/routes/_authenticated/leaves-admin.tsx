import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Loader2,
  Palmtree,
  Settings2,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useLeaveAccess } from "@/lib/leave-permissions";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  adjustLeaveBalance,
  adminCancelActiveLeave,
  decideLeaveRequest,
  listLeaveTypes,
  setLeaveAccrualRule,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "@/lib/leave.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export const Route = createFileRoute("/_authenticated/leaves-admin")({
  component: LeavesAdminPage,
});

function LeavesAdminPage() {
  const { data: me } = useAuth();
  const navigate = useNavigate();
  const leaveAccess = useLeaveAccess();
  const qc = useQueryClient();
  const listTypesFn = useServerFn(listLeaveTypes);
  const decideFn = useServerFn(decideLeaveRequest);

  useEffect(() => {
    if (!leaveAccess.isLoading && !leaveAccess.canOpenLeaveAdmin) {
      navigate({ to: "/leaves", replace: true });
    }
  }, [leaveAccess.isLoading, leaveAccess.canOpenLeaveAdmin, navigate]);

  const typesQ = useQuery({
    queryKey: ["leave-types", me?.id],
    enabled: !!me?.id && leaveAccess.canOpenLeaveAdmin,
    queryFn: () => listTypesFn(),
  });
  const types = (typesQ.data ?? []) as LeaveTypeRow[];

  const requestsQ = useQuery({
    queryKey: ["leave-admin-requests", me?.id],
    enabled: !!me?.id && leaveAccess.canOpenLeaveAdmin,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_requests")
        .select(
          "*, leave_types(code, name, requires_attachment), profiles:user_id(full_name, first_name, last_name)",
        )
        .order("submitted_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as LeaveRequestRow[];
    },
  });

  const deptPending = useMemo(
    () => (requestsQ.data ?? []).filter((r) => r.status === "pending_dept"),
    [requestsQ.data],
  );
  const adminPending = useMemo(
    () => (requestsQ.data ?? []).filter((r) => r.status === "pending_admin"),
    [requestsQ.data],
  );

  // A department manager without admin-stage authority sees only their own
  // department (enforced by RLS) — the copy must not imply branch-wide scope.
  const deptScopedOnly = leaveAccess.pendingQueueMode === "dept";
  const showAdminQueue =
    leaveAccess.pendingQueueMode === "admin" ||
    leaveAccess.pendingQueueMode === "both";
  const historyTitle = deptScopedOnly
    ? "כל הבקשות במחלקה שלי"
    : "כל הבקשות בסניף";

  const [decideTarget, setDecideTarget] = useState<{
    row: LeaveRequestRow;
    stage: "dept" | "admin";
    approve: boolean;
  } | null>(null);
  const [decideNote, setDecideNote] = useState("");

  const decideMut = useMutation({
    mutationFn: async () => {
      if (!decideTarget) return;
      await decideFn({
        data: {
          id: decideTarget.row.id,
          approve: decideTarget.approve,
          note: decideNote.trim() || null,
          stage: decideTarget.stage,
        },
      });
    },
    onSuccess: () => {
      toast.success(decideTarget?.approve ? "הבקשה אושרה" : "הבקשה נדחתה");
      setDecideTarget(null);
      setDecideNote("");
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function displayName(r: LeaveRequestRow) {
    const p = r.profiles;
    return p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || "עובד";
  }

  function RequestList({
    rows,
    stage,
  }: {
    rows: LeaveRequestRow[];
    stage: "dept" | "admin";
  }) {
    const canApprove =
      stage === "dept" ? leaveAccess.isDeptManager : leaveAccess.canApprove;
    const canReject =
      stage === "dept" ? leaveAccess.isDeptManager : leaveAccess.canReject;

    if (rows.length === 0) {
      return <p className="text-sm text-muted-foreground">אין בקשות ממתינות</p>;
    }

    return (
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">
                  {displayName(r)} ·{" "}
                  {r.kind === "cancellation"
                    ? "ביטול · "
                    : r.kind === "extension"
                      ? "הארכה · "
                      : ""}
                  {r.leave_types?.name ?? "חופשה"}
                </div>
                <div className="text-muted-foreground">
                  {r.start_date} – {r.end_date} · {r.days_count} ימים
                </div>
                {r.note && <p className="mt-1">{r.note}</p>}
                {r.balance_warning && (
                  <p className="mt-1 text-xs text-amber-700">אזהרת יתרה</p>
                )}
              </div>
              <Badge className={LEAVE_STATUS_TONE[r.status]}>
                {LEAVE_STATUS_LABEL[r.status]}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {canApprove && (
                <Button
                  size="sm"
                  onClick={() => {
                    setDecideNote("");
                    setDecideTarget({ row: r, stage, approve: true });
                  }}
                >
                  <CheckCircle2 className="h-4 w-4" />
                  אישור
                </Button>
              )}
              {canReject && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setDecideNote("");
                    setDecideTarget({ row: r, stage, approve: false });
                  }}
                >
                  <XCircle className="h-4 w-4" />
                  דחייה
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    );
  }

  if (leaveAccess.isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" dir="rtl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Palmtree className="h-6 w-6" />
            ניהול חופשות
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {deptScopedOnly
              ? "אישורי חופשה לעובדי המחלקה שלך."
              : "אישורים, יתרות ודוחות — לפי הרשאות בדף ההרשאות."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/leaves">החופשות שלי</Link>
        </Button>
      </div>

      <Tabs defaultValue="queue">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="queue">תור אישורים</TabsTrigger>
          {(leaveAccess.canView || leaveAccess.canManageLeave) && (
            <TabsTrigger value="history">היסטוריה / דוח</TabsTrigger>
          )}
          {leaveAccess.canEditBalance && (
            <TabsTrigger value="balances">
              <Wallet className="h-3.5 w-3.5" />
              יתרות
            </TabsTrigger>
          )}
          {leaveAccess.canEditBalance && (
            <TabsTrigger value="accrual">
              <Settings2 className="h-3.5 w-3.5" />
              צבירה
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          {leaveAccess.isDeptManager && (
            <Card className="space-y-3 p-4">
              <h2 className="font-medium">ממתין לאחראי מחלקה</h2>
              {requestsQ.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <RequestList rows={deptPending} stage="dept" />
              )}
            </Card>
          )}
          {showAdminQueue && (
            <Card className="space-y-3 p-4">
              <h2 className="font-medium">ממתין להנהלה</h2>
              {requestsQ.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <RequestList rows={adminPending} stage="admin" />
              )}
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history">
          <Card className="space-y-3 p-4">
            <h2 className="font-medium">{historyTitle}</h2>
            {requestsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-y-auto">
                {(requestsQ.data ?? []).map((r) => (
                  <li key={r.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="font-medium">{displayName(r)}</span>
                        {" · "}
                        {r.leave_types?.name} · {r.start_date} – {r.end_date}
                      </div>
                      <Badge className={LEAVE_STATUS_TONE[r.status]}>
                        {LEAVE_STATUS_LABEL[r.status]}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="balances">
          <BalancesTab types={types} canCancel={leaveAccess.canApprove} />
        </TabsContent>

        <TabsContent value="accrual">
          <AccrualTab types={types} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!decideTarget} onOpenChange={(o) => !o && setDecideTarget(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {decideTarget?.approve ? "אישור בקשה" : "דחיית בקשה"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>הערה (אופציונלי)</Label>
            <Textarea value={decideNote} onChange={(e) => setDecideNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button disabled={decideMut.isPending} onClick={() => decideMut.mutate()}>
              {decideMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "אישור"}
            </Button>
            <Button variant="outline" onClick={() => setDecideTarget(null)}>
              ביטול
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function BalancesTab({
  types,
  canCancel,
}: {
  types: LeaveTypeRow[];
  canCancel: boolean;
}) {
  const qc = useQueryClient();
  const adjustFn = useServerFn(adjustLeaveBalance);
  const cancelFn = useServerFn(adminCancelActiveLeave);
  const [userId, setUserId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");

  const employeesQ = useQuery({
    queryKey: ["leave-balance-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name")
        .eq("is_active", true)
        .order("full_name")
        .limit(500);
      if (error) throw error;
      return data ?? [];
    },
  });

  const balancesQ = useQuery({
    queryKey: ["leave-admin-balances"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_balances")
        .select(
          "id, user_id, leave_type_id, manual_balance, accrued_days, used_days, reserved_days, leave_types(name, code), profiles:user_id(full_name)",
        )
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const adjustMut = useMutation({
    mutationFn: async () => {
      if (!userId || !leaveTypeId) throw new Error("יש לבחור עובד וסוג חופשה");
      const n = Number(delta);
      if (!Number.isFinite(n) || n === 0) throw new Error("ערך לא תקין");
      await adjustFn({
        data: {
          user_id: userId,
          leave_type_id: leaveTypeId,
          delta: n,
          reason: reason.trim() || null,
        },
      });
    },
    onSuccess: () => {
      toast.success("היתרה עודכנה");
      setReason("");
      qc.invalidateQueries({ queryKey: ["leave-admin-balances"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async (uid: string) => {
      await cancelFn({ data: { user_id: uid, note: "ביטול ישיר מהנהלה" } });
    },
    onSuccess: () => {
      toast.success("החופשה בוטלה");
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4">
      <Card className="space-y-3 p-4">
        <h2 className="font-medium">עדכון יתרה ידני</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>עובד</Label>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger>
                <SelectValue placeholder="בחרו עובד" />
              </SelectTrigger>
              <SelectContent>
                {(employeesQ.data ?? []).map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.full_name || `${e.first_name ?? ""} ${e.last_name ?? ""}`.trim()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>סוג</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="סוג חופשה" />
              </SelectTrigger>
              <SelectContent>
                {types.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>שינוי (+/−)</Label>
            <Input value={delta} onChange={(e) => setDelta(e.target.value)} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>סיבה</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <Button disabled={adjustMut.isPending} onClick={() => adjustMut.mutate()}>
          {adjustMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "שמירה"}
        </Button>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">יתרות בסניף</h2>
        <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
          {(balancesQ.data as any[]).map((b) => {
            const available =
              Number(b.manual_balance) +
              Number(b.accrued_days) -
              Number(b.used_days) -
              Number(b.reserved_days);
            return (
              <li
                key={b.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border p-2"
              >
                <div>
                  <span className="font-medium">{b.profiles?.full_name ?? "עובד"}</span>
                  {" · "}
                  {b.leave_types?.name} · זמין {available}
                </div>
                {canCancel && (
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={cancelMut.isPending}
                    onClick={() => cancelMut.mutate(b.user_id)}
                  >
                    ביטול חופשה פעילה
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}

function AccrualTab({ types }: { types: LeaveTypeRow[] }) {
  const setAccrualFn = useServerFn(setLeaveAccrualRule);
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [days, setDays] = useState("1.5");
  const [cap, setCap] = useState("");

  const rulesQ = useQuery({
    queryKey: ["leave-accrual-rules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_accrual_rules")
        .select("*, leave_types(name, code)")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!leaveTypeId) throw new Error("יש לבחור סוג");
      const n = Number(days);
      if (!Number.isFinite(n) || n < 0) throw new Error("ערך לא תקין");
      await setAccrualFn({
        data: {
          leave_type_id: leaveTypeId,
          days_per_month: n,
          max_cap: cap.trim() ? Number(cap) : null,
          is_active: true,
        },
      });
    },
    onSuccess: () => {
      toast.success("כלל הצבירה נשמר");
      rulesQ.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="space-y-4 p-4">
      <h2 className="font-medium">צבירה חודשית לפי סוג</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-2">
          <Label>סוג</Label>
          <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
            <SelectTrigger>
              <SelectValue placeholder="סוג" />
            </SelectTrigger>
            <SelectContent>
              {types.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>ימים לחודש</Label>
          <Input value={days} onChange={(e) => setDays(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>תקרה (אופציונלי)</Label>
          <Input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="ללא" />
        </div>
      </div>
      <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        שמירת כלל
      </Button>
      <ul className="space-y-2 text-sm">
        {(rulesQ.data as any[]).map((r) => (
          <li key={r.id} className="rounded border p-2">
            {r.leave_types?.name}: {r.days_per_month} ימים/חודש
            {r.max_cap != null ? ` · תקרה ${r.max_cap}` : ""}
            {!r.is_active ? " · כבוי" : ""}
          </li>
        ))}
      </ul>
    </Card>
  );
}
