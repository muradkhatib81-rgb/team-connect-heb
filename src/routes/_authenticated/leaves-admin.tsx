import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  FileText,
  Loader2,
  Palmtree,
  Trash2,
  UserMinus,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { useLeaveAccess } from "@/lib/leave-permissions";
import {
  LEAVE_STATUS_TONE,
  adjustLeaveBalance,
  adminCancelActiveLeave,
  decideLeaveRequest,
  getLeaveAttachmentSignedUrl,
  listLeaveTypes,
  purgeLeaveRequest,
  setLeaveEmployeeAccrualRate,
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

function getLeaveStatusLabel(status: string): string {
  const map: Record<string, string> = {
    pending_dept: "leaves.statusPendingDept",
    pending_admin: "leaves.statusPendingAdmin",
    approved: "leaves.statusApproved",
    rejected: "leaves.statusRejected",
    cancelled: "leaves.statusCancelled",
  };
  return i18n.t(map[status] ?? status);
}

function LeavesAdminPage() {
  const { t } = useTranslation();
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
    ? t("leavesAdminPage.historyDeptOnly")
    : leaveAccess.isPlatformOwner
      ? t("leavesAdminPage.historyPlatform")
      : t("leavesAdminPage.historyBranch");

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
      toast.success(decideTarget?.approve ? t("leavesAdminPage.requestApproved") : t("leavesAdminPage.requestRejected"));
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
    return p?.full_name || [p?.first_name, p?.last_name].filter(Boolean).join(" ") || t("leavesAdminPage.defaultEmployee");
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
      return <p className="text-sm text-muted-foreground">{t("leavesAdminPage.noPendingRequests")}</p>;
    }

    return (
      <ul className="space-y-3">
        {rows.map((r) => {
          const deptApproved =
            stage === "admin" ? deptStageApprovedLabel(r) : null;
          return (
          <li key={r.id} className="rounded-lg border p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="font-medium">
                  {displayName(r)} ·{" "}
                  {r.kind === "cancellation"
                    ? t("leaves.kindCancel")
                    : r.kind === "extension"
                      ? t("leaves.kindExtend")
                      : ""}
                  {r.leave_types?.name ?? t("leaves.defaultLeaveName")}
                </div>
                <div className="text-muted-foreground">
                  {formatLeaveDateRange(r.start_date, r.end_date)} · {t("leavesAdminPage.daysCount", { count: r.days_count })}
                </div>
                {deptApproved && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
                    {t("leavesAdminPage.deptApprovedBy")}{" "}
                    <span className="font-semibold">{deptApproved.name}</span>
                    {" · "}
                    {deptApproved.at}
                    <span className="text-muted-foreground">{t("leavesAdminPage.awaitingAdmin")}</span>
                  </div>
                )}
                {r.note && <p className="mt-1">{r.note}</p>}
                {r.balance_warning && (
                  <p className="mt-1 text-xs text-amber-700">{t("leavesAdminPage.balanceWarning")}</p>
                )}
              </div>
              <Badge className={LEAVE_STATUS_TONE[r.status]}>
                {getLeaveStatusLabel(r.status)}
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
                  {t("leavesAdminPage.approve")}
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
                  {t("leavesAdminPage.reject")}
                </Button>
              )}
            </div>
          </li>
          );
        })}
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
            {t("leavesAdminPage.title")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {deptScopedOnly
              ? t("leavesAdminPage.subtitleDept")
              : t("leavesAdminPage.subtitleDefault")}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/leaves">{t("leavesAdminPage.myLeaves")}</Link>
        </Button>
      </div>

      <Tabs defaultValue="queue">
        <TabsList className="flex h-auto flex-wrap gap-1">
          <TabsTrigger value="queue">{t("leavesAdminPage.tabQueue")}</TabsTrigger>
          {leaveAccess.canApprove && (
            <TabsTrigger value="on-leave">
              <Users className="h-3.5 w-3.5" />
              {t("leavesAdminPage.tabOnLeave")}
            </TabsTrigger>
          )}
          {(leaveAccess.canView || leaveAccess.canManageLeave) && (
            <TabsTrigger value="history">{t("leavesAdminPage.tabHistory")}</TabsTrigger>
          )}
          {leaveAccess.canEditBalance && (
            <TabsTrigger value="balances">
              <Wallet className="h-3.5 w-3.5" />
              {t("leavesAdminPage.tabBalances")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="queue" className="space-y-4">
          {leaveAccess.isDeptManager && (
            <Card className="space-y-3 p-4">
              <h2 className="font-medium">{t("leavesAdminPage.pendingDept")}</h2>
              {requestsQ.isLoading ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <RequestList rows={deptPending} stage="dept" />
              )}
            </Card>
          )}
          {showAdminQueue && (
            <Card className="space-y-3 p-4">
              <h2 className="font-medium">{t("leavesAdminPage.pendingAdmin")}</h2>
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
              {t("leavesAdminPage.historyHint")}
            </p>
            {requestsQ.isLoading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (requestsQ.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("leavesAdminPage.noRequestsToShow")}</p>
            ) : (
              <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
                {(requestsQ.data ?? []).map((r) => (
                  <LeaveReportRow
                    key={r.id}
                    row={r}
                    canPurge={leaveAccess.isPlatformOwner}
                  />
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="balances">
          <BalancesTab types={types} />
        </TabsContent>
      </Tabs>

      <Dialog open={!!decideTarget} onOpenChange={(o) => !o && setDecideTarget(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {decideTarget?.approve ? t("leavesAdminPage.approveRequestTitle") : t("leavesAdminPage.rejectRequestTitle")}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>{t("leavesAdminPage.noteOptional")}</Label>
            <Textarea value={decideNote} onChange={(e) => setDecideNote(e.target.value)} rows={3} />
          </div>
          <DialogFooter className="gap-2 sm:justify-start">
            <Button disabled={decideMut.isPending} onClick={() => decideMut.mutate()}>
              {decideMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("leavesAdminPage.approve")}
            </Button>
            <Button variant="outline" onClick={() => setDecideTarget(null)}>
              {t("common.cancel")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function empDisplayName(
  e: {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  },
  fallback?: string,
) {
  return e.full_name || [e.first_name, e.last_name].filter(Boolean).join(" ") || fallback || i18n.t("leavesAdminPage.defaultEmployee");
}

function requestEmployeeName(r: LeaveRequestRow) {
  return empDisplayName(r.profiles ?? {});
}

function decisionVerb(status: LeaveRequestRow["status"]): string {
  if (status === "rejected") return i18n.t("leavesAdminPage.decisionRejected");
  if (status === "cancelled") return i18n.t("leavesAdminPage.decisionCancelled");
  return i18n.t("leavesAdminPage.decisionApproved");
}

function decisionActorLabel(
  r: LeaveRequestRow,
): { verb: string; name: string; at: string } | null {
  const verb = decisionVerb(r.status);
  if (r.admin_decided_by && r.admin_decided_at) {
    const name =
      (r.admin_decider_name || "").trim() ||
      (r.admin_decider ? empDisplayName(r.admin_decider) : "") ||
      i18n.t("leavesAdminPage.defaultManager");
    return { verb, name, at: formatLeaveDateTime(r.admin_decided_at) };
  }
  if (r.dept_decided_by && r.dept_decided_at) {
    const name =
      (r.dept_decider_name || "").trim() ||
      (r.dept_decider ? empDisplayName(r.dept_decider) : "") ||
      i18n.t("leavesAdminPage.defaultManager");
    return { verb, name, at: formatLeaveDateTime(r.dept_decided_at) };
  }
  return null;
}

/** Banner for admin-queue rows that already passed department approval. */
function deptStageApprovedLabel(r: LeaveRequestRow): { name: string; at: string } | null {
  if (!r.dept_decided_by || !r.dept_decided_at) return null;
  const name =
    (r.dept_decider_name || "").trim() ||
    (r.dept_decider ? empDisplayName(r.dept_decider) : "") ||
    i18n.t("leavesAdminPage.defaultDeptHead");
  return { name, at: formatLeaveDateTime(r.dept_decided_at) };
}

function statusBadgeForRow(r: LeaveRequestRow) {
  const life = leaveLifecycleVisual(r.status, r.end_date, undefined, r.kind);
  if (life === "active") {
    return (
      <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
        {i18n.t("leavesAdminPage.activeLeave")}
      </Badge>
    );
  }
  if (life === "done") {
    const cancelled =
      r.status === "cancelled" || r.kind === "cancellation";
    return (
      <Badge className={LEAVE_LIFECYCLE_BADGE.done} variant="outline">
        {cancelled ? i18n.t("leavesAdminPage.lifecycleCancelled") : i18n.t("leavesAdminPage.lifecycleDone")}
      </Badge>
    );
  }
  return (
    <Badge className={LEAVE_STATUS_TONE[r.status]}>{getLeaveStatusLabel(r.status)}</Badge>
  );
}

function SickAttachmentButton({ row }: { row: LeaveRequestRow }) {
  const { t } = useTranslation();
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
      toast.error(e?.message ?? t("leavesAdminPage.cannotOpenDoc"));
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
          {t("leavesAdminPage.medicalDoc")}{attachments.length > 1 ? `: ${a.file_name}` : ""}
        </Button>
      ))}
    </div>
  );
}

function LeaveReportRow({
  row,
  canPurge,
}: {
  row: LeaveRequestRow;
  canPurge?: boolean;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const purgeFn = useServerFn(purgeLeaveRequest);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const life = leaveLifecycleVisual(row.status, row.end_date, undefined, row.kind);
  const decided = decisionActorLabel(row);
  const deptApproved =
    row.status === "pending_admin" ? deptStageApprovedLabel(row) : null;
  const kindPrefix =
    row.kind === "cancellation" ? t("leaves.kindCancel") : row.kind === "extension" ? t("leaves.kindExtend") : "";

  const purgeMut = useMutation({
    mutationFn: async () => {
      await purgeFn({ data: { request_id: row.id } });
    },
    onSuccess: () => {
      toast.success(t("leavesAdminPage.deletedFromHistory"));
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-on-leave"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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
            {row.leave_types?.name ?? t("leaves.defaultLeaveName")}
          </div>
          <div className="text-muted-foreground">
            {formatLeaveDateRange(row.start_date, row.end_date)}
            {" · "}
            <span className="font-medium text-foreground">{t("leavesAdminPage.daysCount", { count: row.days_count })}</span>
          </div>
          {deptApproved ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
              {t("leavesAdminPage.deptApprovedBy")}{" "}
              <span className="font-semibold">{deptApproved.name}</span>
              {" · "}
              {deptApproved.at}
              <span className="text-muted-foreground">{t("leavesAdminPage.awaitingAdmin")}</span>
            </div>
          ) : (
            decided && (
              <div className="text-xs text-muted-foreground">
                {t("leavesAdminPage.decidedBy", { verb: decided.verb })}{" "}
                <span className="font-medium text-foreground">{decided.name}</span>
                {" · "}
                {decided.at}
              </div>
            )
          )}
          {row.note && <p className="text-xs">{row.note}</p>}
          <SickAttachmentButton row={row} />
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          {statusBadgeForRow(row)}
          {canPurge && (
            <Button
              size="sm"
              variant="outline"
              className="text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="h-4 w-4" />
              {t("common.delete")}
            </Button>
          )}
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !o && !purgeMut.isPending && setConfirmOpen(false)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("leavesAdminPage.purgeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("leavesAdminPage.purgeDesc")}
              {" "}
              {requestEmployeeName(row)}
              {formatLeaveDateRange(row.start_date, row.end_date)
                ? ` · ${formatLeaveDateRange(row.start_date, row.end_date)}`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              disabled={purgeMut.isPending}
              onClick={(ev) => {
                ev.preventDefault();
                purgeMut.mutate();
              }}
            >
              {purgeMut.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                t("leavesAdminPage.yesDelete")
              )}
            </AlertDialogAction>
            <AlertDialogCancel disabled={purgeMut.isPending}>{t("leavesAdminPage.back")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
  const { t } = useTranslation();
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
      await cancelFn({ data: { user_id: uid, note: t("leavesAdminPage.cancelLeaveNote") } });
    },
    onSuccess: () => {
      toast.success(t("leavesAdminPage.leaveCancelled"));
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
        t("leavesAdminPage.defaultEmployee");
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
          <h2 className="font-medium">{t("leavesAdminPage.onLeaveTitle")}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("leavesAdminPage.onLeaveDesc")}
          </p>
        </div>
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : error ? (
          <p className="text-sm text-destructive">
            {t("leavesAdminPage.loadError", { message: (error as Error).message })}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("leavesAdminPage.noOnLeaveNow")}</p>
        ) : (
          <ul className="max-h-[32rem] space-y-2 overflow-y-auto">
            {items.map((item) => {
              if (item.source === "request") {
                const r = item.row;
                const decided = decisionActorLabel(r);
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
                        <span className="font-medium text-foreground">{t("leavesAdminPage.daysCount", { count: r.days_count })}</span>
                      </div>
                      {decided && (
                        <div className="text-xs text-muted-foreground">
                          {t("leavesAdminPage.decidedBy", { verb: decided.verb })}{" "}
                          <span className="font-medium text-foreground">{decided.name}</span>
                          {" · "}
                          {decided.at}
                        </div>
                      )}
                      <SickAttachmentButton row={r} />
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
                        {t("leavesAdminPage.activeLeave")}
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
                        {t("leavesAdminPage.cancelLeave")}
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
                            {days} {days === 1 ? t("leavesAdminPage.dayOne") : t("leavesAdminPage.daysMany")}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("leavesAdminPage.manualFromProfile")}
                      {item.set_by_name && (
                        <>
                          {" · "}
                          {t("leavesAdminPage.byActor")}{" "}
                          <span className="font-medium text-foreground">{item.set_by_name}</span>
                          {item.set_at ? ` · ${item.set_at}` : ""}
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <Badge className={LEAVE_LIFECYCLE_BADGE.active} variant="outline">
                      {t("leavesAdminPage.activeLeave")}
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
                      {t("leavesAdminPage.cancelLeave")}
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
            <AlertDialogTitle>{t("leavesAdminPage.cancelLeaveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget && (
                <>
                  {t("leavesAdminPage.cancelLeaveDesc")}{" "}
                  <span className="font-medium text-foreground">{cancelTarget.name}</span>
                  {formatLeaveDateRange(cancelTarget.start, cancelTarget.end)
                    ? ` (${formatLeaveDateRange(cancelTarget.start, cancelTarget.end)})`
                    : ""}
                  {t("leavesAdminPage.cancelLeaveDescSuffix")}
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
                t("leavesAdminPage.yesCancelLeave")
              )}
            </AlertDialogAction>
            <AlertDialogCancel disabled={cancelMut.isPending}>{t("leavesAdminPage.back")}</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type BalanceEmp = {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  id_number: string | null;
  is_active: boolean | null;
};

function BalancesTab({ types }: { types: LeaveTypeRow[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const adjustFn = useServerFn(adjustLeaveBalance);
  const setEmpRateFn = useServerFn(setLeaveEmployeeAccrualRate);
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState("");
  const [rateDrafts, setRateDrafts] = useState<
    Record<string, { days: string; cap: string; useOverride: boolean }>
  >({});
  const [adjustDrafts, setAdjustDrafts] = useState<
    Record<string, { delta: string; reason: string }>
  >({});

  const employeesQ = useQuery({
    queryKey: ["leave-balance-employees"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, first_name, last_name, id_number, is_active")
        .order("full_name")
        .limit(800);
      if (error) throw error;
      return ((data ?? []) as BalanceEmp[]).filter((e) => e.is_active !== false);
    },
  });

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = employeesQ.data ?? [];
    if (!q) return all.slice(0, 40);
    return all
      .filter((e) => {
        const name = empDisplayName(e).toLowerCase();
        const idn = (e.id_number ?? "").toLowerCase();
        return name.includes(q) || idn.includes(q);
      })
      .slice(0, 40);
  }, [employeesQ.data, search]);

  const selected = useMemo(
    () => (employeesQ.data ?? []).find((e) => e.id === userId) ?? null,
    [employeesQ.data, userId],
  );

  const balancesQ = useQuery({
    queryKey: ["leave-admin-balances", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_balances")
        .select(
          "id, user_id, leave_type_id, manual_balance, accrued_days, used_days, reserved_days",
        )
        .eq("user_id", userId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const empRatesQ = useQuery({
    queryKey: ["leave-emp-accrual-rates", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_employee_accrual_rates")
        .select("id, leave_type_id, days_per_month, max_cap, is_active")
        .eq("user_id", userId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const branchRulesQ = useQuery({
    queryKey: ["leave-accrual-rules"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_accrual_rules")
        .select("leave_type_id, days_per_month, max_cap, is_active")
        .eq("is_active", true);
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!userId) {
      setRateDrafts({});
      setAdjustDrafts({});
      return;
    }
    const nextRates: Record<string, { days: string; cap: string; useOverride: boolean }> = {};
    const nextAdj: Record<string, { delta: string; reason: string }> = {};
    for (const t of types) {
      const er = (empRatesQ.data ?? []).find((r: any) => r.leave_type_id === t.id);
      const br = (branchRulesQ.data ?? []).find((r: any) => r.leave_type_id === t.id);
      const useOverride = !!(er && er.is_active);
      nextRates[t.id] = {
        useOverride,
        days: String(
          useOverride
            ? er.days_per_month
            : br?.days_per_month ?? "0",
        ),
        cap: useOverride
          ? er.max_cap != null
            ? String(er.max_cap)
            : ""
          : br?.max_cap != null
            ? String(br.max_cap)
            : "",
      };
      nextAdj[t.id] = { delta: "1", reason: "" };
    }
    setRateDrafts(nextRates);
    setAdjustDrafts(nextAdj);
  }, [userId, types, empRatesQ.data, branchRulesQ.data]);

  const saveRateMut = useMutation({
    mutationFn: async (leaveTypeId: string) => {
      if (!userId) throw new Error(t("leavesAdminPage.errSelectEmployee"));
      const draft = rateDrafts[leaveTypeId];
      if (!draft) throw new Error(t("leavesAdminPage.errNoData"));
      const n = Number(draft.days);
      if (!Number.isFinite(n) || n < 0) throw new Error(t("leavesAdminPage.errInvalidAccrual"));
      const capN = draft.cap.trim() ? Number(draft.cap) : null;
      if (draft.cap.trim() && (!Number.isFinite(capN) || (capN as number) < 0)) {
        throw new Error(t("leavesAdminPage.errInvalidCap"));
      }
      await setEmpRateFn({
        data: {
          user_id: userId,
          leave_type_id: leaveTypeId,
          days_per_month: n,
          max_cap: capN,
          is_active: draft.useOverride,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("leavesAdminPage.accrualSaved"));
      qc.invalidateQueries({ queryKey: ["leave-emp-accrual-rates", userId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const adjustMut = useMutation({
    mutationFn: async (leaveTypeId: string) => {
      if (!userId) throw new Error(t("leavesAdminPage.errSelectEmployee"));
      const draft = adjustDrafts[leaveTypeId];
      const n = Number(draft?.delta);
      if (!Number.isFinite(n) || n === 0) throw new Error(t("leavesAdminPage.errInvalidDelta"));
      await adjustFn({
        data: {
          user_id: userId,
          leave_type_id: leaveTypeId,
          delta: n,
          reason: draft?.reason.trim() || null,
        },
      });
    },
    onSuccess: (_d, leaveTypeId) => {
      toast.success(t("leavesAdminPage.balanceUpdated"));
      setAdjustDrafts((prev) => ({
        ...prev,
        [leaveTypeId]: { delta: "1", reason: "" },
      }));
      qc.invalidateQueries({ queryKey: ["leave-admin-balances", userId] });
      qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-4" lang="he-IL">
      <Card className="space-y-3 p-4">
        <h2 className="font-medium">{t("leavesAdminPage.balancesTitle")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("leavesAdminPage.balancesDesc")}
        </p>
        {employeesQ.isError && (
          <p className="text-sm text-destructive">
            {t("leavesAdminPage.loadEmployeesError", { message: (employeesQ.error as Error).message })}
          </p>
        )}
        <div className="space-y-2">
          <Label>{t("leavesAdminPage.searchEmployee")}</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("leavesAdminPage.searchPlaceholder")}
          />
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto rounded border p-1">
          {employeesQ.isLoading ? (
            <div className="flex justify-center p-3">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : filteredEmployees.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">{t("leavesAdminPage.noEmployeesFound")}</p>
          ) : (
            filteredEmployees.map((e) => {
              const active = e.id === userId;
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setUserId(e.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-right text-sm transition-colors ${
                    active ? "bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                >
                  <span className="font-medium">{empDisplayName(e)}</span>
                  <span className={active ? "opacity-80" : "text-muted-foreground"}>
                    {e.id_number || "—"}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </Card>

      {selected && (
        <Card className="space-y-4 p-4">
          <div>
            <h3 className="font-medium">{empDisplayName(selected)}</h3>
            <p className="text-xs text-muted-foreground">
              {t("leavesAdminPage.idNumber")} {selected.id_number || t("leavesAdminPage.idNotEntered")}
            </p>
          </div>
          {(balancesQ.isLoading || empRatesQ.isLoading || branchRulesQ.isLoading) && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
          <ul className="space-y-4">
            {types.map((leaveType) => {
              const bal = (balancesQ.data ?? []).find((b: any) => b.leave_type_id === leaveType.id);
              const available = bal
                ? Number(bal.manual_balance) +
                  Number(bal.accrued_days) -
                  Number(bal.used_days) -
                  Number(bal.reserved_days)
                : 0;
              const br = (branchRulesQ.data ?? []).find((r: any) => r.leave_type_id === leaveType.id);
              const rate = rateDrafts[leaveType.id] ?? { days: "0", cap: "", useOverride: false };
              const adj = adjustDrafts[leaveType.id] ?? { delta: "1", reason: "" };
              return (
                <li key={leaveType.id} className="space-y-3 rounded border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-medium">{leaveType.name}</span>
                    <span className="text-sm">
                      {t("leavesAdminPage.available")}{" "}
                      <span className="font-semibold tabular-nums">{available}</span>
                      {bal ? (
                        <span className="text-muted-foreground">
                          {" "}
                          {t("leavesAdminPage.balanceBreakdown", {
                            manual: bal.manual_balance,
                            accrued: bal.accrued_days,
                            used: bal.used_days,
                            reserved:
                              Number(bal.reserved_days) > 0
                                ? t("leavesAdminPage.reservedPart", { count: bal.reserved_days })
                                : "",
                          })}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{t("leavesAdminPage.noBalanceRecord")}</span>
                      )}
                    </span>
                  </div>

                  <div className="space-y-2 rounded bg-muted/40 p-2">
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={rate.useOverride}
                          onChange={(e) =>
                            setRateDrafts((prev) => ({
                              ...prev,
                              [leaveType.id]: { ...rate, useOverride: e.target.checked },
                            }))
                          }
                        />
                        {t("leavesAdminPage.personalRate")}
                      </label>
                      <span className="text-xs text-muted-foreground">
                        {t("leavesAdminPage.branchDefault")}{" "}
                        {br
                          ? t("leavesAdminPage.branchRate", {
                              days: br.days_per_month,
                              cap:
                                br.max_cap != null
                                  ? t("leavesAdminPage.branchCap", { cap: br.max_cap })
                                  : "",
                            })
                          : t("leavesAdminPage.branchNotSet")}
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="space-y-1">
                        <Label className="text-xs">{t("leavesAdminPage.daysPerMonth")}</Label>
                        <Input
                          value={rate.days}
                          disabled={!rate.useOverride}
                          onChange={(e) =>
                            setRateDrafts((prev) => ({
                              ...prev,
                              [leaveType.id]: { ...rate, days: e.target.value },
                            }))
                          }
                          inputMode="decimal"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t("leavesAdminPage.capOptional")}</Label>
                        <Input
                          value={rate.cap}
                          disabled={!rate.useOverride}
                          onChange={(e) =>
                            setRateDrafts((prev) => ({
                              ...prev,
                              [leaveType.id]: { ...rate, cap: e.target.value },
                            }))
                          }
                          placeholder={t("leavesAdminPage.noCap")}
                          inputMode="decimal"
                        />
                      </div>
                      <div className="flex items-end">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={saveRateMut.isPending}
                          onClick={() => saveRateMut.mutate(leaveType.id)}
                        >
                          {saveRateMut.isPending && saveRateMut.variables === leaveType.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : rate.useOverride ? (
                            t("leavesAdminPage.saveRate")
                          ) : (
                            t("leavesAdminPage.revertToBranch")
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <div className="space-y-1">
                      <Label className="text-xs">{t("leavesAdminPage.balanceDelta")}</Label>
                      <Input
                        value={adj.delta}
                        onChange={(e) =>
                          setAdjustDrafts((prev) => ({
                            ...prev,
                            [leaveType.id]: { ...adj, delta: e.target.value },
                          }))
                        }
                        inputMode="decimal"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-1">
                      <Label className="text-xs">{t("leavesAdminPage.reason")}</Label>
                      <Input
                        value={adj.reason}
                        onChange={(e) =>
                          setAdjustDrafts((prev) => ({
                            ...prev,
                            [leaveType.id]: { ...adj, reason: e.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        size="sm"
                        disabled={adjustMut.isPending}
                        onClick={() => adjustMut.mutate(leaveType.id)}
                      >
                        {adjustMut.isPending && adjustMut.variables === leaveType.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t("leavesAdminPage.updateBalance")
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
