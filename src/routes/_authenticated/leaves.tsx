import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Loader2, Palmtree, Send } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import {
  LEAVE_STATUS_LABEL,
  LEAVE_STATUS_TONE,
  listLeaveTypes,
  registerLeaveAttachment,
  submitLeaveRequest,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from "@/lib/leave.functions";
import { useLeaveAccess } from "@/lib/leave-permissions";
import { formatLeaveDateRange, leaveDecisionMessage } from "@/lib/employee-leave";
import { HebrewDateInput } from "@/components/hebrew-datetime";
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

export const Route = createFileRoute("/_authenticated/leaves")({
  component: LeavesPage,
});

function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysIso(base: string, days: number): string {
  const d = new Date(base + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function LeavesPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const leaveAccess = useLeaveAccess();
  const listTypesFn = useServerFn(listLeaveTypes);
  const submitFn = useServerFn(submitLeaveRequest);
  const registerAttachFn = useServerFn(registerLeaveAttachment);
  const minDate = todayIso();
  const maxDate = addDaysIso(minDate, 30);

  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState(minDate);
  const [endDate, setEndDate] = useState(minDate);
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [extendForId, setExtendForId] = useState<string | null>(null);
  const [extendTypeId, setExtendTypeId] = useState("");
  const [extendEndDate, setExtendEndDate] = useState("");
  const [extendNote, setExtendNote] = useState("");
  const [extendFile, setExtendFile] = useState<File | null>(null);

  const typesQ = useQuery({
    queryKey: ["leave-types", me?.id],
    enabled: !!me?.id,
    queryFn: () => listTypesFn(),
  });

  const types = (typesQ.data ?? []) as LeaveTypeRow[];
  const selectedType = types.find((t) => t.id === leaveTypeId) ?? null;

  const balancesQ = useQuery({
    queryKey: ["my-leave-balances", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_balances")
        .select("leave_type_id, manual_balance, accrued_days, used_days, reserved_days, leave_types(code, name)")
        .eq("user_id", me!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const myRequestsQ = useQuery({
    queryKey: ["my-leave-requests", me?.id],
    enabled: !!me?.id,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("leave_requests")
        .select(
          `*,
          leave_types(code, name, requires_attachment),
          admin_decider:profiles!admin_decided_by(full_name, first_name, last_name),
          dept_decider:profiles!dept_decided_by(full_name, first_name, last_name)`,
        )
        .eq("user_id", me!.id)
        .order("submitted_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as LeaveRequestRow[];
    },
  });

  const approvedLeaves = useMemo(
    () =>
      (myRequestsQ.data ?? []).filter(
        (r) => r.kind === "leave" && r.status === "approved" && r.end_date >= minDate,
      ),
    [myRequestsQ.data, minDate],
  );

  /** Approved leave that is active today — can request extension (only while profile is on leave). */
  const activeLeaves = useMemo(
    () =>
      approvedLeaves.filter(
        (r) =>
          !!me?.on_leave &&
          r.start_date <= minDate &&
          r.end_date >= minDate,
      ),
    [approvedLeaves, minDate, me?.on_leave],
  );

  /** Future approved leaves — cancel request available before leave starts. */
  const upcomingApprovedLeaves = useMemo(
    () => approvedLeaves.filter((r) => r.start_date > minDate),
    [approvedLeaves, minDate],
  );

  const extendType = types.find((t) => t.id === extendTypeId) ?? null;

  const submitMut = useMutation({
    mutationFn: async () => {
      if (!leaveTypeId) throw new Error("יש לבחור סוג חופשה");
      if (selectedType?.requires_attachment && !file) {
        throw new Error("חופשת מחלה דורשת צירוף מסמך רפואי");
      }
      const { id } = await submitFn({
        data: {
          leave_type_id: leaveTypeId,
          start_date: startDate,
          end_date: endDate,
          note: note.trim() || null,
          kind: "leave",
        },
      });
      if (file && me?.id) {
        const safe = file.name.replace(/[^\w.\u0590-\u05FF-]+/g, "_");
        const path = `${me.id}/${id}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage
          .from("leave-attachments")
          .upload(path, file, { upsert: false, contentType: file.type || undefined });
        if (upErr) throw new Error(upErr.message);
        await registerAttachFn({
          data: {
            request_id: id,
            storage_path: path,
            file_name: file.name,
            mime_type: file.type || null,
            file_size: file.size,
          },
        });
      }
      return id;
    },
    onSuccess: () => {
      toast.success("בקשת החופשה נשלחה");
      setNote("");
      setFile(null);
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelMut = useMutation({
    mutationFn: async (source: LeaveRequestRow) => {
      return submitFn({
        data: {
          leave_type_id: source.leave_type_id,
          start_date: source.start_date,
          end_date: source.end_date,
          note: `בקשת ביטול לחופשה ${formatLeaveDateRange(source.start_date, source.end_date)}`,
          kind: "cancellation",
          cancels_request_id: source.id,
        },
      });
    },
    onSuccess: () => {
      toast.success("בקשת הביטול נשלחה");
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const extendMut = useMutation({
    mutationFn: async (source: LeaveRequestRow) => {
      if (!extendTypeId) throw new Error("יש לבחור סוג חופשה להארכה");
      if (!extendEndDate) throw new Error("יש לבחור תאריך סיום חדש");
      const extStart = addDaysIso(source.end_date, 1);
      if (extendEndDate < extStart) {
        throw new Error("תאריך הסיום חייב להיות אחרי סיום החופשה הנוכחית");
      }
      if (extendType?.requires_attachment && !extendFile) {
        throw new Error("הארכה לחופשת מחלה דורשת צירוף מסמך רפואי");
      }
      const { id } = await submitFn({
        data: {
          leave_type_id: extendTypeId,
          start_date: extStart,
          end_date: extendEndDate,
          note: extendNote.trim() || `הארכת חופשה עד ${extendEndDate}`,
          kind: "extension",
          extends_request_id: source.id,
        },
      });
      if (extendFile && me?.id) {
        const safe = extendFile.name.replace(/[^\w.\u0590-\u05FF-]+/g, "_");
        const path = `${me.id}/${id}/${Date.now()}_${safe}`;
        const { error: upErr } = await supabase.storage
          .from("leave-attachments")
          .upload(path, extendFile, {
            upsert: false,
            contentType: extendFile.type || undefined,
          });
        if (upErr) throw new Error(upErr.message);
        await registerAttachFn({
          data: {
            request_id: id,
            storage_path: path,
            file_name: extendFile.name,
            mime_type: extendFile.type || null,
            file_size: extendFile.size,
          },
        });
      }
      return id;
    },
    onSuccess: () => {
      toast.success("בקשת ההארכה נשלחה");
      setExtendForId(null);
      setExtendTypeId("");
      setExtendEndDate("");
      setExtendNote("");
      setExtendFile(null);
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balances"] });
      qc.invalidateQueries({ queryKey: ["leave-admin-requests"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6" dir="rtl" lang="he-IL">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Palmtree className="h-6 w-6" />
            חופשות
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            הגשת בקשת חופשה עד 30 יום קדימה. חופשה רגילה וחופשת מחלה נפרדות.
          </p>
        </div>
        {leaveAccess.canOpenLeaveAdmin && (
          <Button asChild variant="outline" size="sm">
            <Link to="/leaves-admin">ניהול חופשות</Link>
          </Button>
        )}
      </div>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium">היתרות שלי</h2>
        {balancesQ.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (balancesQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">עדיין לא הוגדרה יתרה. ניתן להגיש בקשה בכל מקרה.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {(balancesQ.data as any[]).map((b) => {
              const available =
                Number(b.manual_balance) +
                Number(b.accrued_days) -
                Number(b.used_days) -
                Number(b.reserved_days);
              return (
                <div key={b.leave_type_id} className="rounded-lg border p-3 text-sm">
                  <div className="font-medium">{b.leave_types?.name ?? "חופשה"}</div>
                  <div className="mt-1 text-muted-foreground">
                    זמין: <span className="font-semibold text-foreground">{available}</span> ימים
                  </div>
                  <div className="text-xs text-muted-foreground">
                    בשימוש {b.used_days} · שמור {b.reserved_days}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card className="space-y-4 p-4">
        <h2 className="font-medium">בקשה חדשה</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label>סוג חופשה</Label>
            <Select value={leaveTypeId} onValueChange={setLeaveTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="בחרו סוג" />
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
            <Label>מתאריך</Label>
            <HebrewDateInput
              value={startDate}
              min={minDate}
              max={maxDate}
              onChange={(v) => {
                setStartDate(v);
                if (endDate < v) setEndDate(v);
              }}
            />
          </div>
          <div className="space-y-2">
            <Label>עד תאריך</Label>
            <HebrewDateInput
              value={endDate}
              min={startDate || minDate}
              max={maxDate}
              onChange={setEndDate}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>הערה</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="אופציונלי"
            />
          </div>
          {selectedType?.requires_attachment && (
            <div className="space-y-2 sm:col-span-2">
              <Label>מסמך רפואי (חובה)</Label>
              <Input
                type="file"
                accept="image/*,.pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
          )}
        </div>
        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          אם אין מספיק יתרה תופיע אזהרה בלבד — הבקשה עדיין תישלח.
        </p>
        <Button
          disabled={submitMut.isPending || !leaveTypeId}
          onClick={() => submitMut.mutate()}
        >
          {submitMut.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          שליחת בקשה
        </Button>
      </Card>

      {activeLeaves.length > 0 && (
        <Card className="space-y-3 border-emerald-200 bg-emerald-50/40 p-4">
          <h2 className="font-medium">חופשה פעילה — בקשת הארכה</h2>
          <p className="text-xs text-muted-foreground">
            במהלך החופשה ניתן לבקש הארכה. אפשר לבחור סוג אחר להארכה (רגילה / מחלה). אותו מסלול אישורים.
          </p>
          {activeLeaves.map((r) => {
            const extStart = addDaysIso(r.end_date, 1);
            const isOpen = extendForId === r.id;
            return (
              <div key={r.id} className="space-y-3 rounded-lg border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="font-medium">
                      {r.leave_types?.name ?? "חופשה"} · {formatLeaveDateRange(r.start_date, r.end_date)}
                    </div>
                    <div className="text-muted-foreground">{r.days_count} ימים</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={isOpen ? "secondary" : "default"}
                      onClick={() => {
                        if (isOpen) {
                          setExtendForId(null);
                          return;
                        }
                        setExtendForId(r.id);
                        setExtendTypeId(r.leave_type_id);
                        setExtendEndDate(addDaysIso(r.end_date, 1));
                        setExtendNote("");
                        setExtendFile(null);
                      }}
                    >
                      {isOpen ? "סגור" : "בקשת הארכה"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cancelMut.isPending}
                      onClick={() => cancelMut.mutate(r)}
                    >
                      בקשת ביטול
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div className="grid gap-3 border-t pt-3 sm:grid-cols-2">
                    <div className="space-y-2 sm:col-span-2">
                      <Label>סוג ההארכה</Label>
                      <Select value={extendTypeId} onValueChange={setExtendTypeId}>
                        <SelectTrigger>
                          <SelectValue placeholder="בחרו סוג" />
                        </SelectTrigger>
                        <SelectContent>
                          {types.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[11px] text-muted-foreground">
                        אפשר לבחור סוג שונה מהחופשה המקורית. הימים ינוכו מיתרת הסוג שנבחר.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label>תחילת הארכה</Label>
                      <HebrewDateInput value={extStart} onChange={() => {}} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>עד תאריך</Label>
                      <HebrewDateInput
                        value={extendEndDate}
                        min={extStart}
                        max={maxDate}
                        onChange={setExtendEndDate}
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label>הערה</Label>
                      <Textarea
                        value={extendNote}
                        onChange={(e) => setExtendNote(e.target.value)}
                        rows={2}
                        placeholder="אופציונלי"
                      />
                    </div>
                    {extendType?.requires_attachment && (
                      <div className="space-y-2 sm:col-span-2">
                        <Label>מסמך רפואי (חובה להארכת מחלה)</Label>
                        <Input
                          type="file"
                          accept="image/*,.pdf"
                          onChange={(e) => setExtendFile(e.target.files?.[0] ?? null)}
                        />
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <Button
                        disabled={extendMut.isPending || !extendTypeId || !extendEndDate}
                        onClick={() => extendMut.mutate(r)}
                      >
                        {extendMut.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                        שליחת בקשת הארכה
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {upcomingApprovedLeaves.length > 0 && (
        <Card className="space-y-3 p-4">
          <h2 className="font-medium">חופשות מאושרות עתידיות — בקשת ביטול</h2>
          {upcomingApprovedLeaves.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {r.leave_types?.name ?? "חופשה"} · {formatLeaveDateRange(r.start_date, r.end_date)}
                  </div>
                  <div className="text-muted-foreground">{r.days_count} ימים</div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cancelMut.isPending}
                  onClick={() => cancelMut.mutate(r)}
                >
                  בקשת ביטול
                </Button>
              </div>
            ))}
        </Card>
      )}

      <Card className="space-y-3 p-4">
        <h2 className="font-medium">הבקשות שלי</h2>
        {myRequestsQ.isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (myRequestsQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">אין בקשות עדיין</p>
        ) : (
          <ul className="space-y-2">
            {(myRequestsQ.data ?? []).map((r) => {
              const decision = leaveDecisionMessage(r);
              return (
              <li key={r.id} className="rounded-lg border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="font-medium">
                    {r.kind === "cancellation"
                      ? "ביטול · "
                      : r.kind === "extension"
                        ? "הארכה · "
                        : ""}
                    {r.leave_types?.name ?? "חופשה"} · {formatLeaveDateRange(r.start_date, r.end_date)}
                  </div>
                  <Badge className={LEAVE_STATUS_TONE[r.status]}>
                    {LEAVE_STATUS_LABEL[r.status]}
                  </Badge>
                </div>
                {decision && (
                  <p
                    className={
                      decision.tone === "rejected"
                        ? "mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-900"
                        : decision.tone === "cancelled"
                          ? "mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs text-amber-950"
                          : "mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900"
                    }
                  >
                    {decision.text}
                  </p>
                )}
                {r.balance_warning && (
                  <p className="mt-1 text-xs text-amber-700">נשלח עם אזהרת יתרה</p>
                )}
                {r.note && <p className="mt-1 text-muted-foreground">{r.note}</p>}
              </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
