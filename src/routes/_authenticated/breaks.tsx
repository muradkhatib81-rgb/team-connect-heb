import { createFileRoute, Link } from "@tanstack/react-router";
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
import { useTranslation } from "react-i18next";
import {
  BREAK_PRE_ACTIVE_STATUSES,
  BREAK_PENDING_APPROVAL_STATUSES,
  BREAK_STATUS_TONE,
  getBreakStatusLabel,
  BreakLiveTimer,
  consumedBreakSettingIdsForJerusalemDay,
  fmtBreakTime,
  isBreakOnJerusalemDay,
  isoFromLocalTime,
  toLocalTime,
  todayJerusalemDate,
} from "@/lib/break-workflow";
import {
  useCanUserRequestBreak,
  useShiftSelfServiceVisible,
} from "@/lib/use-shift-self-service-visible";
import i18n from "@/i18n";

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
  planned_start: string | null;
  created_at: string;
}

function BreaksPage() {
  const { t } = useTranslation();
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const canRequestQ = useCanUserRequestBreak();
  const canRequestBreak = canRequestQ.data === true;
  const shiftGate = useShiftSelfServiceVisible();
  const canShowRequestForm = canRequestBreak && shiftGate.isVisible;

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
    // Include Jerusalem day so the list resets after midnight.
    queryKey: ["my-break-requests", me?.id, todayJerusalemDate()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("break_requests")
        .select("*")
        .eq("user_id", me!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as BreakRequest[];
    },
  });

  // Realtime — refresh own requests and active break settings.
  // Also: toast the employee when one of their own requests transitions to 'active'
  // (i.e. their break just started). Server-time driven — nothing local decides start.
  useEffect(() => {
    if (!me?.id) return;
    const ch = supabase
      .channel("break-requests-self-rt")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "break_requests", filter: `user_id=eq.${me.id}` },
        () => qc.invalidateQueries({ queryKey: ["my-break-requests"] }),
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "break_requests", filter: `user_id=eq.${me.id}` },
        (payload: any) => {
          const prev = payload.old?.status;
          const next = payload.new?.status;
          const actorName =
            (payload.new?.ended_by_manager_name as string | null)?.trim() ||
            (payload.new?.cancelled_by_name as string | null)?.trim() ||
            i18n.t("breaks.manager");
          const atRaw =
            (payload.new?.completed_at as string | null) ||
            (payload.new?.cancelled_at as string | null) ||
            (payload.new?.rejected_at as string | null);
          const when = atRaw
            ? new Intl.DateTimeFormat("he-IL", {
                timeZone: "Asia/Jerusalem",
                day: "2-digit",
                month: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hour12: false,
                numberingSystem: "latn",
              }).format(new Date(atRaw))
            : "";
          const whenPart = when ? ` · ${when}` : "";

          if (prev !== "active" && next === "active") {
            toast.success(i18n.t("breaks.breakStarted"));
          } else if (prev !== "completed" && next === "completed") {
            toast(i18n.t("breaks.breakEnded"));
          } else if (prev !== "rejected" && next === "rejected") {
            toast.error(`${i18n.t("breaks.breakRejected").replace("{name}", actorName)}${whenPart}`);
          } else if (prev !== "ended_by_manager" && next === "ended_by_manager") {
            toast(`${i18n.t("breaks.breakEndedByMgr").replace("{name}", actorName)}${whenPart}`);
          } else if (prev !== "cancelled_by_manager" && next === "cancelled_by_manager") {
            toast(`${i18n.t("breaks.breakCancelledByMgr").replace("{name}", actorName)}${whenPart}`);
          }
          qc.invalidateQueries({ queryKey: ["my-break-requests"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "break_requests", filter: `user_id=eq.${me.id}` },
        () => qc.invalidateQueries({ queryKey: ["my-break-requests"] }),
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
  const requiresApproval = policyQ.data?.requires_approval === true;
  const policyLoaded = !!policyQ.data && !policyQ.isLoading;

  // ---- Submit form
  const [settingId, setSettingId] = useState("");
  const [timeStr, setTimeStr] = useState("");
  const [note, setNote] = useState("");
  const [timeDialogOpen, setTimeDialogOpen] = useState(false);

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!settingId) throw new Error(i18n.t("breaks.errSelectType"));
      const setting = settingsQ.data?.find((s) => s.id === settingId);
      if (!setting) throw new Error(i18n.t("breaks.errTypeNotFound"));
      if (!timeStr) throw new Error(i18n.t("breaks.errSelectTime"));
      const requestedAt = isoFromLocalTime(timeStr);
      const { data: policy } = await (supabase as any).rpc("get_break_policy");
      const effectiveRequiresApproval = policy?.requires_approval === true;
      const { error } = await supabase.from("break_requests").insert({
        user_id: me!.id,
        department_id: me!.department_id ?? null,
        break_setting_id: settingId,
        duration_minutes: setting.duration_minutes,
        planned_duration: setting.duration_minutes,
        requested_at: requestedAt,
        planned_start: requestedAt,
        note: note.trim() || null,
      });
      if (error) throw error;
      return { requiresApproval: effectiveRequiresApproval, timeStr };
    },
    onSuccess: (result) => {
      toast.success(
        result.requiresApproval
          ? i18n.t("breaks.requestSentApproval")
          : i18n.t("breaks.breakScheduled").replace("{time}", result.timeStr),
      );
      setTimeDialogOpen(false);
      setSettingId("");
      setTimeStr("");
      setNote("");
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("breaks.errSend")),
  });

  const today = todayJerusalemDate();
  const consumedTypeIds = useMemo(
    () => consumedBreakSettingIdsForJerusalemDay(myReqQ.data ?? [], today),
    [myReqQ.data, today],
  );
  const availableSettings = useMemo(
    () => (settingsQ.data ?? []).filter((s) => !consumedTypeIds.has(s.id)),
    [settingsQ.data, consumedTypeIds],
  );

  function openTimeDialog() {
    if (!settingId) {
      toast.error(i18n.t("breaks.errSelectType"));
      return;
    }
    if (!timeStr) setTimeStr(toLocalTime(new Date().toISOString()));
    setTimeDialogOpen(true);
  }

  if (!me) return null;

  // Show only today's requests (Asia/Jerusalem) — list clears every calendar day.
  const myReqs = useMemo(() => {
    const day = todayJerusalemDate();
    return (myReqQ.data ?? []).filter((r) => isBreakOnJerusalemDay(r, day));
  }, [myReqQ.data]);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Coffee className="size-5" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold">{i18n.t("breaks.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {policyLoaded && requiresApproval
              ? i18n.t("breaks.subtitleApproval")
              : i18n.t("breaks.subtitleAuto")}
          </p>
          {canShowRequestForm ? (
            <Button variant="link" className="h-auto p-0 text-sm" asChild>
              <Link to="/break-planning">{i18n.t("breaks.planLink")}</Link>
            </Button>
          ) : (
            <p className="text-sm text-muted-foreground">{i18n.t("breaks.planUnavailable")}</p>
          )}
        </div>
      </header>

      <Tabs defaultValue={canShowRequestForm ? "request" : "mine"} className="space-y-4">
        <TabsList>
          {canShowRequestForm && <TabsTrigger value="request">{i18n.t("breaks.tabRequest")}</TabsTrigger>}
          <TabsTrigger value="mine">{i18n.t("breaks.tabMine")}</TabsTrigger>
        </TabsList>

        {canShowRequestForm && (
          <TabsContent value="request">
            <Card className="card-elevated p-5 space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>{i18n.t("breaks.breakType")}</Label>
                  <Select value={settingId} onValueChange={setSettingId}>
                    <SelectTrigger>
                      <SelectValue placeholder={i18n.t("breaks.selectType")} />
                    </SelectTrigger>
                    <SelectContent>
                      {availableSettings.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} · {s.duration_minutes} {t("common.minutesShort")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
              <Label htmlFor="brk-note">{i18n.t("breaks.noteLabel")}</Label>
                <Textarea
                  id="brk-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={i18n.t("breaks.notePlaceholder")}
                  rows={3}
                />
              </div>
              <Button
                className="gap-2"
                onClick={openTimeDialog}
                disabled={submitMut.isPending || !policyLoaded}
              >
                {submitMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {requiresApproval ? i18n.t("breaks.sendRequest") : i18n.t("breaks.goToBreak")}
              </Button>
            </Card>
          </TabsContent>
        )}

        <Dialog open={timeDialogOpen} onOpenChange={setTimeDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{i18n.t("breaks.timeDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="brk-time-dialog">{i18n.t("breaks.timeLabel")}</Label>
                <Input
                  id="brk-time-dialog"
                  type="time"
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {i18n.t("breaks.timeSavedNote")}
              </p>
            </div>
            <DialogFooter>
              <Button
                className="gap-2"
                onClick={() => submitMut.mutate()}
                disabled={submitMut.isPending || !timeStr}
              >
                {submitMut.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                {requiresApproval ? i18n.t("breaks.sendRequest") : i18n.t("breaks.goToBreak")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <TabsContent value="mine">
          {myReqQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : myReqs.length === 0 ? (
            <Card className="card-elevated p-8 text-center text-sm text-muted-foreground">
              {i18n.t("breaks.noRequests")}
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
                      {setting?.name ?? i18n.t("breaks.defaultBreak")} · {r.duration_minutes}{" "}
                      {t("common.minutesShort")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {i18n.t("breaks.timeLabel2")} {fmtBreakTime(showTime)}
                        {r.status === "active" && r.ends_at ? (
                          <> · {i18n.t("breaks.endsAt")}{fmtBreakTime(r.ends_at)}</>
                        ) : null}
                      </p>
                      {r.status === "active" && r.ends_at && (
                        <BreakLiveTimer endsAt={r.ends_at} />
                      )}
                      {(BREAK_PRE_ACTIVE_STATUSES as readonly string[]).includes(r.status) && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {i18n.t("breaks.autoStartNote").replace("{time}", fmtBreakTime(showTime))}
                        </p>
                      )}
                      {r.note && (
                        <p className="text-xs text-muted-foreground mt-1">{i18n.t("breaks.notePrefix")} {r.note}</p>
                      )}
                    </div>
                    <Badge variant={BREAK_STATUS_TONE[r.status] ?? "secondary"}>
                      {getBreakStatusLabel(r.status)}
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
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<BreakRequest | null>(null);
  const [rejectTarget, setRejectTarget] = useState<BreakRequest | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const pending = all.filter((r) =>
    (BREAK_PENDING_APPROVAL_STATUSES as readonly string[]).includes(r.status),
  );

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
      if (r.status === "cancelled" || r.status === "cancelled_by_employee" || r.status === "cancelled_by_manager" || r.status === "completed" || r.status === "rejected" || r.status === "ended_by_manager") return false;
      const ref = r.approved_at_time ?? r.requested_at;
      const rt = new Date(ref).getTime();
      return Math.abs(rt - t) <= 60_000; // within 1 minute
    });
  }

  const approveMut = useMutation({
    mutationFn: async (input: { id: string; approvedTimeIso: string }) => {
      const { error } = await (supabase as any).rpc("approve_break_request", {
        _id: input.id,
        _approved_at_time: input.approvedTimeIso,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(i18n.t("breaks.approved"));
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("breaks.errApprove")),
  });

  const rejectMut = useMutation({
    mutationFn: async (input: { id: string; reason?: string }) => {
      const { error } = await (supabase as any).rpc("reject_break_request", {
        _id: input.id,
        _reason: input.reason?.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(i18n.t("breaks.rejected"));
      setRejectTarget(null);
      setRejectReason("");
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["my-break-requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-pending-breaks"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("breaks.errReject")),
  });

  const cancelMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc("cancel_break_request", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(i18n.t("breaks.cancelled"));
      qc.invalidateQueries({ queryKey: ["all-break-requests"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
    },
    onError: (e: any) => toast.error(e?.message ?? i18n.t("breaks.errCancel")),
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
        {i18n.t("breaks.noPending")}
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
                    {setting?.name ?? i18n.t("breaks.defaultBreak")} · {r.duration_minutes}{" "}
                    {t("common.minutesShort")} · {i18n.t("breaks.requestedHour")}{" "}
                    {fmtBreakTime(r.requested_at)}
                  </p>
                  {r.note && (
                    <p className="text-xs text-muted-foreground mt-1">{i18n.t("breaks.notePrefix")} {r.note}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => setEditing(r)}
                  >
                    <Pencil className="size-4" /> {i18n.t("breaks.changeTime")}
                  </Button>
                  <Button
                    size="sm"
                    className="gap-1"
                    onClick={() =>
                      approveMut.mutate({ id: r.id, approvedTimeIso: r.requested_at })
                    }
                    disabled={approveMut.isPending}
                  >
                    <CheckCircle2 className="size-4" /> {i18n.t("breaks.approve")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1 text-destructive hover:text-destructive"
                    onClick={() => {
                      setRejectTarget(r);
                      setRejectReason("");
                    }}
                  >
                    <Trash2 className="size-4" /> {i18n.t("breaks.reject")}
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
                      ? i18n.t("breaks.overlapWarn")
                      : `${i18n.t("breaks.overlapCount").replace("{n}", String(overlaps.length))}`}
                  </div>
                  <ul className="mt-1 list-disc pr-4 space-y-0.5">
                    {overlaps.map((o) => {
                      const p = profOf(o.user_id);
                      const mgr = isDeptMgr(o.user_id, p?.department_id ?? null);
                      return (
                        <li key={o.id}>
                          {p?.full_name ?? "—"} · {deptName(p?.department_id ?? null)}
                          {mgr && ` · ${i18n.t("breaks.deptManager")}`}
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
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{i18n.t("breaks.rejectTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {i18n.t("breaks.rejectDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2">
            <Label htmlFor="reject-reason">{i18n.t("breaks.rejectReasonLabel")}</Label>
            <Textarea
              id="reject-reason"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              className="mt-1.5"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{i18n.t("breaks.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                rejectTarget &&
                rejectMut.mutate({ id: rejectTarget.id, reason: rejectReason })
              }
              disabled={rejectMut.isPending}
            >
              {i18n.t("breaks.reject")}
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
      <DialogTitle>{i18n.t("breaks.editTimeTitle")}</DialogTitle>
            </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="bk-newtime">{i18n.t("breaks.newTime")}</Label>
          <Input
            id="bk-newtime"
            type="time"
            value={t}
            onChange={(e) => setT(e.target.value)}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {i18n.t("breaks.approvedTimeNote")}
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
          {i18n.t("breaks.approveWithTime")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
