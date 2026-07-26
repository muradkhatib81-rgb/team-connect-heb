import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Palmtree,
  Settings2,
  UserMinus,
  Users,
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
  getLeaveAttachmentSignedUrl,
  listLeaveTypes,
  setLeaveAccrualRule,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "@/lib/leave.functions";
import {
  countLeaveDays,
  formatLeaveDateRange,
  formatLeaveDateTime,
  isEmployeeCurrentlyOnLeave,
  leaveLifecycleVisual,
  LEAVE_LIFECYCLE_BADGE,
  LEAVE_LIFECYCLE_ROW,
  leaveOffLabel,
} from "@/lib/employee-leave";
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
          `*,
          leave_types(code, name, requires_attachment),
          profiles!user_id(full_name, first_name, last_name),
          admin_decider:profiles!admin_decided_by(full_name, first_name, last_name),
          dept_decider:profiles!dept_decided_by(full_name, first_name, last_name),
          leave_request_attachments(id, file_name, storage_path, mime_type)`,
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
                  {formatLeaveDateRange(r.start_date, r.end_date)} · {r.days_count} ימים
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
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6" dir="rtl" lang="he-IL">
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
          {leaveAccess.canApprove && (
            <TabsTrigger value="on-leave">
              <Users className="h-3.5 w-3.5" />
              עובדים בחופשה
            </TabsTrigger>
          )}
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

        {leaveAccess.canApprove && (
          <TabsContent value="on-leave">
            <ActiveOnLeaveTab />
          </TabsContent>
        )}

        <TabsContent value="history">
          <Card className="space-y-3 p-4">
            <h2 className="font-medium">{historyTitle}</h2>
            <p className="text-xs text-muted-foreground">
              אדום = חופשה פעילה · ירוק = הסתיימה או בוטלה. חופשת מחלה — לחצו לפתיחת המסמך המצורף.
            </p>
            {requestsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
                {(requestsQ.data ?? []).map((r) => (
                  <LeaveReportRow key={r.id} row={r} />
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="balances">
          <BalancesTab types={types} />
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

function empDisplayName(e: {
  full_name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}) {
  return e.full_name || [e.first_name, e.last_name].filter(Boolean).join(" ") || "עובד";
}

function requestEmployeeName(r: LeaveRequestRow) {
  return empDisplayName(r.profiles ?? {});
}

function approverLabel(r: LeaveRequestRow): { name: string; at: string } | null {
  if (r.admin_decided_by && r.admin_decided_at) {
    return {
      name: empDisplayName(r.admin_decider ?? {}),
      at: formatLeaveDateTime(r.admin_decided_at),
    };
  }
  if (r.dept_decided_by && r.dept_decided_at) {
    return {
      name: empDisplayName(r.dept_decider ?? {}),
      at: formatLeaveDateTime(r.dept_decided_at),
    };
  }
  return null;
}

function statusBadgeForRow(r: LeaveRequestRow) {
  const life = leaveLifecycleVisual(r.status, r.end_date, undefined, r.kind);
  if (life === "active") {
    return (
      <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
        חופשה פעילה
      </Badge>
    );
  }
  if (life === "done") {
    const cancelled =
      r.status === "cancelled" || r.kind === "cancellation";
    return (
      <Badge className={LEAVE_LIFECYCLE_BADGE.done} variant="outline">
        {cancelled ? "בוטלה" : "הסתיימה"}
      </Badge>
    );
  }
  return (
    <Badge className={LEAVE_STATUS_TONE[r.status]}>{LEAVE_STATUS_LABEL[r.status]}</Badge>
  );
}

function SickAttachmentButton({ row }: { row: LeaveRequestRow }) {
  const getUrlFn = useServerFn(getLeaveAttachmentSignedUrl);
  const [busy, setBusy] = useState(false);
  const attachments = row.leave_request_attachments ?? [];
  const isSick = row.leave_types?.code === "sick";
  if (!isSick || attachments.length === 0) return null;

  async function openAttachment(id: string) {
    setBusy(true);
    try {
      const { url } = await getUrlFn({ data: { attachment_id: id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "לא ניתן לפתוח את המסמך");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {attachments.map((a) => (
        <Button
          key={a.id}
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          className="gap-1.5"
          onClick={() => openAttachment(a.id)}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          מסמך רפואי{attachments.length > 1 ? `: ${a.file_name}` : ""}
        </Button>
      ))}
    </div>
  );
}

function LeaveReportRow({ row }: { row: LeaveRequestRow }) {
  const life = leaveLifecycleVisual(row.status, row.end_date, undefined, row.kind);
  const approved = approverLabel(row);
  const kindPrefix =
    row.kind === "cancellation" ? "ביטול · " : row.kind === "extension" ? "הארכה · " : "";

  return (
    <li
      className={`rounded-lg border p-3 text-sm space-y-1.5 ${
        life ? LEAVE_LIFECYCLE_ROW[life] : ""
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="font-medium">
            {requestEmployeeName(row)}
            {" · "}
            {kindPrefix}
            {row.leave_types?.name ?? "חופשה"}
          </div>
          <div className="text-muted-foreground">
            {formatLeaveDateRange(row.start_date, row.end_date)}
            {" · "}
            <span className="font-medium text-foreground">{row.days_count} ימים</span>
          </div>
          {approved && (
            <div className="text-xs text-muted-foreground">
              אושר על ידי <span className="font-medium text-foreground">{approved.name}</span>
              {" · "}
              {approved.at}
            </div>
          )}
          {row.note && <p className="text-xs">{row.note}</p>}
          <SickAttachmentButton row={row} />
        </div>
        {statusBadgeForRow(row)}
      </div>
    </li>
  );
}

function todayIsoJerusalem(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Managers with approve permission — not department heads. */
type ManualOnLeaveRow = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  on_leave: boolean;
  leave_start_date: string | null;
  leave_end_date: string | null;
  leave_type_code: string | null;
  departments: { name: string | null } | null;
};

type OnLeaveListItem =
  | { source: "request"; row: LeaveRequestRow }
  | {
      source: "manual";
      user_id: string;
      name: string;
      department_name: string | null;
      leave_start_date: string | null;
      leave_end_date: string | null;
      leave_type_code: string | null;
      set_by_name: string | null;
      set_at: string | null;
    };

function ActiveOnLeaveTab() {
  const qc = useQueryClient();
  const cancelFn = useServerFn(adminCancelActiveLeave);
  const [cancelTarget, setCancelTarget] = useState<{
    user_id: string;
    name: string;
    start: string | null;
    end: string | null;
  } | null>(null);
  const today = todayIsoJerusalem();

  const requestsQ = useQuery({
    queryKey: ["leave-admin-on-leave", "requests", today],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_requests")
        .select(
          `*,
          leave_types(code, name, requires_attachment),
          profiles!user_id(full_name, first_name, last_name),
          admin_decider:profiles!admin_decided_by(full_name, first_name, last_name),
          dept_decider:profiles!dept_decided_by(full_name, first_name, last_name),
          leave_request_attachments(id, file_name, storage_path, mime_type)`,
        )
        .eq("status", "approved")
        .eq("kind", "leave")
        .gte("end_date", today)
        .order("start_date", { ascending: true })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as LeaveRequestRow[];
    },
  });

  // Manual / profile leave (employee file) — same source as ניהול עובדים "בחופשה".
  const profilesQ = useQuery({
    queryKey: ["leave-admin-on-leave", "profiles", today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, first_name, last_name, on_leave, leave_start_date, leave_end_date, leave_type_code, departments(name)",
        )
        .or(`on_leave.eq.true,leave_end_date.gte.${today}`)
        .limit(500);
      if (error) throw error;
      return (data ?? []) as ManualOnLeaveRow[];
    },
  });

  const onLeaveProfileIds = useMemo(
    () =>
      (profilesQ.data ?? [])
        .filter((p) => isEmployeeCurrentlyOnLeave(p, today))
        .map((p) => p.id),
    [profilesQ.data, today],
  );

  // Who set manual leave — latest leave_audit_log.manual_leave_set per employee.
  const manualSettersQ = useQuery({
    enabled: onLeaveProfileIds.length > 0,
    queryKey: ["leave-admin-on-leave", "manual-setters", today, onLeaveProfileIds.slice().sort().join(",")],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_audit_log")
        .select("user_id, actor_id, occurred_at")
        .eq("action", "manual_leave_set")
        .in("user_id", onLeaveProfileIds)
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) throw error;

      const latestByUser = new Map<string, { actor_id: string | null; at: string }>();
      for (const row of data ?? []) {
        const uid = row.user_id as string | null;
        if (!uid || latestByUser.has(uid)) continue;
        latestByUser.set(uid, {
          actor_id: (row.actor_id as string | null) ?? null,
          at: formatLeaveDateTime(row.occurred_at as string),
        });
      }

      const actorIds = Array.from(
        new Set(
          Array.from(latestByUser.values())
            .map((v) => v.actor_id)
            .filter((id): id is string => !!id),
        ),
      );
      const namesById = new Map<string, string>();
      if (actorIds.length > 0) {
        const { data: actors, error: actorsErr } = await supabase
          .from("profiles")
          .select("id, full_name, first_name, last_name")
          .in("id", actorIds);
        if (actorsErr) throw actorsErr;
        for (const a of actors ?? []) {
          namesById.set(a.id, empDisplayName(a));
        }
      }

      const byUser = new Map<string, { name: string; at: string }>();
      for (const [uid, info] of latestByUser) {
        const name = info.actor_id ? namesById.get(info.actor_id) : null;
        if (!name) continue;
        byUser.set(uid, { name, at: info.at });
      }
      return byUser;
    },
  });

  const cancelMut = useMutation({
    mutationFn: async (uid: string) => {
      await cancelFn({ data: { user_id: uid, note: "ביטול ישיר מניהול חופשות" } });
    },
    onSuccess: () => {
      toast.success("החופשה בוטלה — הסידור והתראת העובד עודכנו");
      setCancelTarget(null);
      qc.invalidateQueries({ queryKey: ["leave-admin-on-leave"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-balances"] });
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedules"] });
      qc.invalidateQueries({ queryKey: ["emp-dash-notif"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["dashboard-shift-cards"] });
      qc.invalidateQueries({ queryKey: ["notifications"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = useMemo((): OnLeaveListItem[] => {
    const requests = requestsQ.data ?? [];
    const coveredByRequest = new Set(requests.map((r) => r.user_id));
    const setters = manualSettersQ.data;
    const list: OnLeaveListItem[] = requests.map((row) => ({ source: "request", row }));

    for (const p of profilesQ.data ?? []) {
      if (!isEmployeeCurrentlyOnLeave(p, today)) continue;
      if (coveredByRequest.has(p.id)) continue;
      const name =
        p.full_name ||
        [p.first_name, p.last_name].filter(Boolean).join(" ") ||
        "עובד";
      const setter = setters?.get(p.id);
      list.push({
        source: "manual",
        user_id: p.id,
        name,
        department_name: p.departments?.name ?? null,
        leave_start_date: p.leave_start_date,
        leave_end_date: p.leave_end_date,
        leave_type_code: p.leave_type_code,
        set_by_name: setter?.name ?? null,
        set_at: setter?.at ?? null,
      });
    }

    list.sort((a, b) => {
      const aStart =
        a.source === "request" ? a.row.start_date : a.leave_start_date ?? "";
      const bStart =
        b.source === "request" ? b.row.start_date : b.leave_start_date ?? "";
      return aStart.localeCompare(bStart);
    });
    return list;
  }, [requestsQ.data, profilesQ.data, manualSettersQ.data, today]);

  const loading =
    requestsQ.isLoading ||
    profilesQ.isLoading ||
    (onLeaveProfileIds.length > 0 && manualSettersQ.isLoading);
  const error = requestsQ.error ?? profilesQ.error ?? manualSettersQ.error;

  return (
    <>
      <Card className="space-y-3 p-4">
        <div>
          <h2 className="font-medium">עובדים בחופשה</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            חופשות פעילות (אדום) — כולל בקשות שאושרו וחופשה ידנית מקובץ העובד.
            ביטול מעדכן את הסידור ומודיע לעובד. אחראי מחלקה אינו יכול לבטל מכאן.
          </p>
        </div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-destructive">
            לא ניתן לטעון: {(error as Error).message}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין עובדים בחופשה כרגע.</p>
        ) : (
          <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
            {items.map((item) => {
              if (item.source === "request") {
                const r = item.row;
                const approved = approverLabel(r);
                return (
                  <li
                    key={`req-${r.id}`}
                    className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm ${LEAVE_LIFECYCLE_ROW.active}`}
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="font-medium">
                        {requestEmployeeName(r)} · {r.leave_types?.name ?? leaveOffLabel(null)}
                      </div>
                      <div className="text-muted-foreground">
                        {formatLeaveDateRange(r.start_date, r.end_date)}
                        {" · "}
                        <span className="font-medium text-foreground">{r.days_count} ימים</span>
                      </div>
                      {approved && (
                        <div className="text-xs text-muted-foreground">
                          אושר על ידי{" "}
                          <span className="font-medium text-foreground">{approved.name}</span>
                          {" · "}
                          {approved.at}
                        </div>
                      )}
                      <SickAttachmentButton row={r} />
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
                        חופשה פעילה
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive border-destructive/40 hover:bg-destructive/10"
                        onClick={() =>
                          setCancelTarget({
                            user_id: r.user_id,
                            name: requestEmployeeName(r),
                            start: r.start_date,
                            end: r.end_date,
                          })
                        }
                      >
                        <UserMinus className="h-4 w-4" />
                        ביטול חופשה
                      </Button>
                    </div>
                  </li>
                );
              }

              const days = countLeaveDays(item.leave_start_date, item.leave_end_date);
              const range = formatLeaveDateRange(item.leave_start_date, item.leave_end_date);
              return (
                <li
                  key={`manual-${item.user_id}`}
                  className={`flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 text-sm ${LEAVE_LIFECYCLE_ROW.active}`}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="font-medium">
                      {item.name} · {leaveOffLabel(item.leave_type_code)}
                    </div>
                    {item.department_name && (
                      <div className="text-xs text-muted-foreground">{item.department_name}</div>
                    )}
                    <div className="text-muted-foreground">
                      {range ?? "—"}
                      {days != null && (
                        <>
                          {" · "}
                          <span className="font-medium text-foreground">
                            {days} {days === 1 ? "יום" : "ימים"}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      הוזן ידנית מקובץ העובד
                      {item.set_by_name && (
                        <>
                          {" · "}
                          על ידי{" "}
                          <span className="font-medium text-foreground">{item.set_by_name}</span>
                          {item.set_at ? ` · ${item.set_at}` : ""}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
                      חופשה פעילה
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-destructive border-destructive/40 hover:bg-destructive/10"
                      onClick={() =>
                        setCancelTarget({
                          user_id: item.user_id,
                          name: item.name,
                          start: item.leave_start_date,
                          end: item.leave_end_date,
                        })
                      }
                    >
                      <UserMinus className="h-4 w-4" />
                      ביטול חופשה
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <AlertDialog
        open={!!cancelTarget}
        onOpenChange={(o) => !o && !cancelMut.isPending && setCancelTarget(null)}
      >
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>לבטל את החופשה?</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <>
                  יבוטל החופש של{" "}
                  <span className="font-medium text-foreground">{cancelTarget.name}</span>
                  {formatLeaveDateRange(cancelTarget.start, cancelTarget.end)
                    ? ` (${formatLeaveDateRange(cancelTarget.start, cancelTarget.end)})`
                    : ""}
                  . הסידור יתעדכן, והעובד יקבל התראה בדשבורד עם שמך ותאריך הביטול.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={cancelMut.isPending}
              onClick={(ev) => {
                ev.preventDefault();
                if (cancelTarget) cancelMut.mutate(cancelTarget.user_id);
              }}
            >
              {cancelMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "כן, בטל חופשה"
              )}
            </AlertDialogAction>
            <AlertDialogCancel disabled={cancelMut.isPending}>חזרה</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function BalancesTab({ types }: { types: LeaveTypeRow[] }) {
  const qc = useQueryClient();
  const adjustFn = useServerFn(adjustLeaveBalance);
  const [userId, setUserId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState("");

  const employeesQ = useQuery({
    queryKey: ["leave-balance-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, is_active")
        .order("full_name")
        .limit(500);
      if (error) throw error;
      return (data ?? []).filter((e) => e.is_active !== false);
    },
  });

  const balancesQ = useQuery({
    queryKey: ["leave-admin-balances"],
    queryFn: async () => {
      // Avoid ambiguous PostgREST embeds (profiles:user_id) that throw on some schemas.
      const { data, error } = await (supabase as any)
        .from("leave_balances")
        .select(
          "id, user_id, leave_type_id, manual_balance, accrued_days, used_days, reserved_days, leave_types(name, code)",
        )
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of employeesQ.data ?? []) {
      map.set(e.id, empDisplayName(e));
    }
    return map;
  }, [employeesQ.data]);

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

  const balanceRows = balancesQ.data ?? [];

  return (
    <div className="space-y-4" lang="he-IL">
      <Card className="space-y-3 p-4">
        <h2 className="font-medium">עדכון יתרה ידני</h2>
        {employeesQ.isError && (
          <p className="text-sm text-destructive">
            לא ניתן לטעון עובדים: {(employeesQ.error as Error).message}
          </p>
        )}
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
                    {empDisplayName(e)}
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
            <Input value={delta} onChange={(e) => setDelta(e.target.value)} inputMode="decimal" />
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
        {balancesQ.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : balancesQ.isError ? (
          <p className="text-sm text-destructive">
            לא ניתן לטעון יתרות: {(balancesQ.error as Error).message}
          </p>
        ) : balanceRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">אין יתרות עדיין. עדכנו יתרה ידנית למעלה.</p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
            {balanceRows.map((b: any) => {
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
                    <span className="font-medium">
                      {nameById.get(b.user_id) ?? "עובד"}
                    </span>
                    {" · "}
                    {b.leave_types?.name} · זמין {available}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
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
        .select("id, leave_type_id, days_per_month, max_cap, is_active, leave_types(name, code)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      if (!leaveTypeId) throw new Error("יש לבחור סוג");
      const n = Number(days);
      if (!Number.isFinite(n) || n < 0) throw new Error("ערך לא תקין");
      const capN = cap.trim() ? Number(cap) : null;
      if (cap.trim() && (!Number.isFinite(capN) || (capN as number) < 0)) {
        throw new Error("תקרה לא תקינה");
      }
      await setAccrualFn({
        data: {
          leave_type_id: leaveTypeId,
          days_per_month: n,
          max_cap: capN,
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

  const rules = rulesQ.data ?? [];

  return (
    <Card className="space-y-4 p-4" lang="he-IL">
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
          <Input value={days} onChange={(e) => setDays(e.target.value)} inputMode="decimal" />
        </div>
        <div className="space-y-2">
          <Label>תקרה (אופציונלי)</Label>
          <Input value={cap} onChange={(e) => setCap(e.target.value)} placeholder="ללא" inputMode="decimal" />
        </div>
      </div>
      <Button disabled={saveMut.isPending} onClick={() => saveMut.mutate()}>
        {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "שמירת כלל"}
      </Button>
      {rulesQ.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      ) : rulesQ.isError ? (
        <p className="text-sm text-destructive">
          לא ניתן לטעון כללי צבירה: {(rulesQ.error as Error).message}
        </p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">אין כללים עדיין.</p>
      ) : (
        <ul className="space-y-2 text-sm">
          {rules.map((r: any) => (
            <li key={r.id} className="rounded border p-2">
              {r.leave_types?.name}: {r.days_per_month} ימים/חודש
              {r.max_cap != null ? ` · תקרה ${r.max_cap}` : ""}
              {!r.is_active ? " · כבוי" : ""}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
