import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  CalendarDays,
  ChevronRight,
  ChevronLeft,
  Copy,
  Send,
  CheckCircle2,
  XCircle,
  Loader2,
  Save,
  AlertTriangle,
  Trash2,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import {
  createOrGetSchedule,
  saveScheduleShifts,
  submitSchedule,
  approveSchedule,
  rejectSchedule,
  copyPreviousWeek,
  deleteSchedule,
} from "@/lib/schedules.functions";
import { formatHeDate } from "@/lib/date-format";

type SchedulesSearch = { dept?: string; week?: string; view?: "pending" | "editor" };
export const Route = createFileRoute("/_authenticated/schedules")({
  component: SchedulesPage,
  validateSearch: (s: Record<string, unknown>): SchedulesSearch => ({
    dept: typeof s.dept === "string" ? s.dept : undefined,
    week: typeof s.week === "string" ? s.week : undefined,
    view: s.view === "pending" || s.view === "editor" ? s.view : undefined,
  }),
});

type Shift = "morning" | "evening" | "off";
const SHIFT_LABEL: Record<Shift | "none", string> = {
  morning: "בוקר",
  evening: "ערב",
  off: "חופש",
  none: "—",
};
const SHIFT_CLASS: Record<Shift, string> = {
  morning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100",
  evening: "bg-indigo-100 text-indigo-900 dark:bg-indigo-950 dark:text-indigo-100",
  off: "bg-muted text-muted-foreground",
};
const STATUS_LABEL = {
  draft: "טיוטה",
  pending_approval: "ממתין לאישור",
  approved: "מאושר",
  rejected: "נדחה",
} as const;
const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  draft: "secondary",
  pending_approval: "outline",
  approved: "default",
  rejected: "destructive",
};
const DAY_NAMES = ["א'", "ב'", "ג'", "ד'", "ה'", "ו'", "ש'"];

function getWeekStart(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function SchedulesPage() {
  const { data: me } = useAuth();
  const qc = useQueryClient();
  const search = Route.useSearch();

  const isMainAdmin = !!me?.roles.includes("main_admin");
  const isBranchMgr =
    !!me?.roles.includes("branch_manager") || !!me?.roles.includes("assistant_manager");
  const isDeptMgr = !!me?.roles.includes("department_manager");
  const isEmployee = !isMainAdmin && !isBranchMgr && !isDeptMgr;

  // Granular flags from user_task_permissions
  const permsQ = useQuery({
    enabled: !!me?.id,
    queryKey: ["my-perms", me?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_task_permissions")
        .select("can_create_schedule, can_approve_schedule, can_publish_schedule")
        .eq("user_id", me!.id)
        .maybeSingle();
      return (
        data ?? {
          can_create_schedule: false,
          can_approve_schedule: false,
          can_publish_schedule: false,
        }
      );
    },
  });
  const canApprove = isMainAdmin || (isBranchMgr && !!permsQ.data?.can_approve_schedule);
  const canPublishDirect =
    isMainAdmin || (isBranchMgr && !!permsQ.data?.can_publish_schedule);
  const canCreate =
    isMainAdmin || isDeptMgr || (isBranchMgr && !!permsQ.data?.can_create_schedule);


  // Department selection
  const deptsQ = useQuery({
    queryKey: ["departments-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name, is_active")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const myDeptId = me?.department_id ?? null;
  const [selectedDept, setSelectedDept] = useState<string | null>(search.dept ?? null);
  useEffect(() => {
    if (selectedDept) return;
    if (search.dept) setSelectedDept(search.dept);
    else if (isDeptMgr && !isMainAdmin && !isBranchMgr && myDeptId) setSelectedDept(myDeptId);
    else if (isEmployee && myDeptId) setSelectedDept(myDeptId);
    else if (deptsQ.data?.length) setSelectedDept(deptsQ.data[0].id);
  }, [deptsQ.data, myDeptId, selectedDept, isDeptMgr, isMainAdmin, isBranchMgr, isEmployee, search.dept]);

  const [weekStart, setWeekStart] = useState(() =>
    search.week ? getWeekStart(new Date(search.week + "T00:00:00Z")) : getWeekStart(new Date()),
  );
  const weekEnd = addDaysISO(weekStart, 6);
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i)),
    [weekStart],
  );

  // Default view for approvers = pending approvals list across all departments they can see.
  const [view, setView] = useState<"pending" | "editor">(
    search.view ?? (search.dept || search.week ? "editor" : canApprove ? "pending" : "editor"),
  );
  useEffect(() => {
    if (canApprove && view === "editor" && !selectedDept) setView("pending");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canApprove]);

  const pendingQ = useQuery({
    enabled: canApprove,
    queryKey: ["schedules-pending"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select(
          "id, department_id, week_start, week_end, status, created_by, submitted_at, submitted_by",
        )
        .eq("status", "pending_approval")
        .order("submitted_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  const pendingCreatorIds = useMemo(() => {
    const s = new Set<string>();
    for (const p of pendingQ.data ?? []) {
      if (p.created_by) s.add(p.created_by);
      if (p.submitted_by) s.add(p.submitted_by);
    }
    return Array.from(s);
  }, [pendingQ.data]);

  const pendingPeopleQ = useQuery({
    enabled: pendingCreatorIds.length > 0,
    queryKey: ["pending-people", pendingCreatorIds.join(",")],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", pendingCreatorIds);
      const m: Record<string, string> = {};
      for (const r of data ?? []) m[r.id] = r.full_name;
      return m;
    },
  });


  // Schedule for selected dept+week
  const schedQ = useQuery({
    enabled: !!selectedDept,
    queryKey: ["schedule", selectedDept, weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedules")
        .select("*")
        .eq("department_id", selectedDept!)
        .eq("week_start", weekStart)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // For employees: only show schedule if approved
  const visible =
    isEmployee
      ? schedQ.data?.status === "approved"
        ? schedQ.data
        : null
      : schedQ.data;

  // Employees in this department
  const empsQ = useQuery({
    enabled: !!selectedDept,
    queryKey: ["dept-employees", selectedDept],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, is_active")
        .eq("department_id", selectedDept!)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  // Shifts (only if a schedule exists and is visible)
  const shiftsQ = useQuery({
    enabled: !!visible?.id,
    queryKey: ["schedule-shifts", visible?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_shifts")
        .select("employee_id, day_date, shift, published_shift")
        .eq("schedule_id", visible!.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  // Local edits map: emp -> day -> shift
  const [edits, setEdits] = useState<Record<string, Record<string, Shift>>>({});
  useEffect(() => {
    const next: Record<string, Record<string, Shift>> = {};
    for (const s of shiftsQ.data ?? []) {
      next[s.employee_id] ??= {};
      next[s.employee_id][s.day_date] = s.shift as Shift;
    }
    setEdits(next);
  }, [shiftsQ.data]);

  // Published-snapshot map (from DB) — drives the "modified after publish" marker
  // and persists across refreshes for all viewers of an approved schedule.
  const publishedMap = useMemo(() => {
    const m: Record<string, Record<string, Shift | null>> = {};
    for (const s of shiftsQ.data ?? []) {
      m[s.employee_id] ??= {};
      m[s.employee_id][s.day_date] = ((s as any).published_shift ?? null) as Shift | null;
    }
    return m;
  }, [shiftsQ.data]);

  // Realtime: keep schedule list synced
  useEffect(() => {
    const ch = supabase
      .channel("schedules-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "schedules" }, () => {
        qc.invalidateQueries({ queryKey: ["schedule"] });
        qc.invalidateQueries({ queryKey: ["schedules-pending"] });
        qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
      })

      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_shifts" },
        () => qc.invalidateQueries({ queryKey: ["schedule-shifts"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // ---- Server fns ----
  const createFn = useServerFn(createOrGetSchedule);
  const saveFn = useServerFn(saveScheduleShifts);
  const submitFn = useServerFn(submitSchedule);
  const approveFn = useServerFn(approveSchedule);
  const rejectFn = useServerFn(rejectSchedule);
  const copyFn = useServerFn(copyPreviousWeek);

  const createMut = useMutation({
    mutationFn: () => createFn({ data: { department_id: selectedDept!, week_start: weekStart } }),
    onSuccess: () => {
      toast.success("נוצרה טיוטה");
      qc.invalidateQueries({ queryKey: ["schedule", selectedDept, weekStart] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const saveMut = useMutation({
    mutationFn: () => {
      const list: { employee_id: string; day_date: string; shift: Shift }[] = [];
      for (const [emp, m] of Object.entries(edits)) {
        for (const [day, shift] of Object.entries(m)) {
          list.push({ employee_id: emp, day_date: day, shift });
        }
      }
      return saveFn({ data: { schedule_id: visible!.id, shifts: list } });
    },
    onSuccess: () => {
      toast.success("נשמר");
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      // Persist any unsaved local edits before validating on the server,
      // so the validator sees the actual on-screen schedule.
      const list: { employee_id: string; day_date: string; shift: Shift }[] = [];
      for (const [emp, m] of Object.entries(edits)) {
        for (const [day, shift] of Object.entries(m)) {
          list.push({ employee_id: emp, day_date: day, shift });
        }
      }
      await saveFn({ data: { schedule_id: visible!.id, shifts: list } });
      return submitFn({ data: { schedule_id: visible!.id } });
    },
    onSuccess: (r: any) => {
      toast.success(r?.published ? "הסידור אושר ופורסם" : "נשלח לאישור");
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });


  const approveMut = useMutation({
    mutationFn: () => approveFn({ data: { schedule_id: visible!.id } }),
    onSuccess: () => {
      toast.success("הסידור אושר ופורסם");
      qc.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNote, setRejectNote] = useState("");
  const rejectMut = useMutation({
    mutationFn: () => rejectFn({ data: { schedule_id: visible!.id, note: rejectNote } }),
    onSuccess: () => {
      toast.success("הסידור נדחה");
      setRejectOpen(false);
      setRejectNote("");
      qc.invalidateQueries({ queryKey: ["schedule"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "שגיאה"),
  });

  const [copyOpen, setCopyOpen] = useState(false);
  const copyMut = useMutation({
    mutationFn: () => copyFn({ data: { schedule_id: visible!.id } }),
    onSuccess: (r) => {
      toast.success(`הועתקו ${r.count} שיבוצים מהשבוע הקודם`);
      setCopyOpen(false);
      qc.invalidateQueries({ queryKey: ["schedule-shifts", visible?.id] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה");
      setCopyOpen(false);
    },
  });

  const deleteFn = useServerFn(deleteSchedule);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteMut = useMutation({
    mutationFn: () => deleteFn({ data: { schedule_id: visible!.id } }),
    onSuccess: () => {
      toast.success("סידור העבודה נמחק");
      setDeleteOpen(false);
      qc.invalidateQueries({ queryKey: ["schedule"] });
      qc.invalidateQueries({ queryKey: ["schedules-pending"] });
      qc.invalidateQueries({ queryKey: ["dashboard-schedules"] });
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "שגיאה");
      setDeleteOpen(false);
    },
  });

  const canDelete =
    !!visible &&
    !isEmployee &&
    (isMainAdmin ||
      canApprove ||
      canPublishDirect ||
      (isDeptMgr &&
        visible.department_id === myDeptId &&
        (visible.status === "draft" || visible.status === "rejected")));

  function setShift(empId: string, day: string, shift: Shift) {
    setEdits((prev) => ({ ...prev, [empId]: { ...(prev[empId] ?? {}), [day]: shift } }));
  }

  const editable =
    !!visible &&
    !isEmployee &&
    (((visible.status === "draft" || visible.status === "rejected") &&
      (isMainAdmin ||
        (isDeptMgr && visible.department_id === myDeptId) ||
        (isBranchMgr && !!permsQ.data?.can_create_schedule)))
      || (visible.status === "approved" && (isMainAdmin || canPublishDirect))
      || (visible.status === "pending_approval" && (isMainAdmin || canApprove || canPublishDirect)));


  const canShowApprove =
    !!visible &&
    visible.status === "pending_approval" &&
    canApprove &&
    visible.created_by !== me?.id;

  const deptNameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const d of deptsQ.data ?? []) m[d.id] = d.name;
    return m;
  }, [deptsQ.data]);

  function openScheduleFromPending(p: {
    department_id: string;
    week_start: string;
  }) {
    setSelectedDept(p.department_id);
    setWeekStart(p.week_start);
    setView("editor");
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CalendarDays className="size-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">סידורי עבודה</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {view === "pending" && canApprove
              ? "ממתינים לאישור — כל המחלקות"
              : `${formatHeDate(weekStart)} – ${formatHeDate(weekEnd)}`}
          </p>
        </div>
      </header>

      {canApprove && (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant={view === "pending" ? "default" : "outline"}
            onClick={() => setView("pending")}
          >
            ממתינים לאישור
            {pendingQ.data && pendingQ.data.length > 0 && (
              <Badge variant="secondary" className="mr-2">
                {pendingQ.data.length}
              </Badge>
            )}
          </Button>
          <Button
            size="sm"
            variant={view === "editor" ? "default" : "outline"}
            onClick={() => setView("editor")}
          >
            עריכת סידור שבועי
          </Button>
        </div>
      )}

      {canApprove && view === "pending" ? (
        <Card className="card-elevated p-0 overflow-hidden">
          {pendingQ.isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="size-6 animate-spin text-primary" />
            </div>
          ) : !pendingQ.data || pendingQ.data.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              אין סידורי עבודה הממתינים לאישור.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3">מחלקה</th>
                  <th className="text-right p-3">טווח תאריכים</th>
                  <th className="text-right p-3">נוצר ע״י</th>
                  <th className="text-right p-3">נשלח</th>
                  <th className="text-right p-3">סטטוס</th>
                  <th className="text-right p-3" />
                </tr>
              </thead>
              <tbody>
                {pendingQ.data.map((p) => (
                  <tr key={p.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">
                      {deptNameById[p.department_id] ?? "—"}
                    </td>
                    <td className="p-3">
                      {formatHeDate(p.week_start)} – {formatHeDate(p.week_end)}
                    </td>
                    <td className="p-3">
                      {pendingPeopleQ.data?.[p.created_by ?? ""] ?? "—"}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {p.submitted_at ? formatHeDate(p.submitted_at) : "—"}
                    </td>
                    <td className="p-3">
                      <Badge variant={STATUS_VARIANT[p.status]}>
                        {STATUS_LABEL[p.status as keyof typeof STATUS_LABEL]}
                      </Badge>
                    </td>
                    <td className="p-3 text-left">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openScheduleFromPending(p)}
                      >
                        פתח לאישור
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      ) : (
        <>


      <Card className="card-elevated p-4 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDaysISO(weekStart, -7))}
            aria-label="שבוע קודם"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setWeekStart(getWeekStart(new Date()))}
          >
            השבוע
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setWeekStart(addDaysISO(weekStart, 7))}
            aria-label="שבוע הבא"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>

        <div className="flex-1">
          {isDeptMgr && !isMainAdmin && !isBranchMgr ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
              {deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}
            </div>
          ) : isEmployee ? (
            <div className="text-sm font-medium px-3 py-2 bg-muted rounded-md">
              {deptsQ.data?.find((d) => d.id === selectedDept)?.name ?? "—"}
            </div>
          ) : (
            <Select
              value={selectedDept ?? undefined}
              onValueChange={(v) => setSelectedDept(v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="בחר מחלקה" />
              </SelectTrigger>
              <SelectContent>
                {(deptsQ.data ?? []).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {visible && (
          <Badge variant={STATUS_VARIANT[visible.status]} className="self-center">
            {STATUS_LABEL[visible.status as keyof typeof STATUS_LABEL]}
          </Badge>
        )}
      </Card>

      {/* No schedule yet */}
      {schedQ.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      ) : !visible ? (
        <Card className="card-elevated p-8 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            {isEmployee
              ? "אין סידור מאושר לשבוע זה."
              : "לא קיים סידור לשבוע זה במחלקה זו."}
          </p>
          {canCreate && !isEmployee && (
            <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>
              {createMut.isPending && <Loader2 className="size-4 animate-spin" />}
              צור טיוטה
            </Button>
          )}
        </Card>
      ) : (
        <>
          {visible.status === "rejected" && visible.rejection_note && (
            <Card className="card-elevated p-4 border-destructive/40 bg-destructive/5">
              <div className="flex gap-2 items-start">
                <AlertTriangle className="size-4 text-destructive mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">הסידור נדחה — נדרשים תיקונים</p>
                  <p className="text-sm mt-1">{visible.rejection_note}</p>
                </div>
              </div>
            </Card>
          )}

          {/* Actions bar */}
          <div className="flex flex-wrap gap-2">
            {editable && (visible.status === "approved" || visible.status === "pending_approval") && (
              <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
                {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                שמור שינויים
              </Button>
            )}
            {editable && visible.status !== "approved" && visible.status !== "pending_approval" && (
              <>
                <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} size="sm">
                  {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                  שמור טיוטה
                </Button>
                <Button
                  onClick={() => submitMut.mutate()}
                  disabled={submitMut.isPending}
                  size="sm"
                  variant="default"
                >
                  {submitMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  {canPublishDirect ? "אשר ופרסם" : "שלח לאישור"}
                </Button>

                <Button
                  onClick={() => setCopyOpen(true)}
                  size="sm"
                  variant="outline"
                >
                  <Copy className="size-4" />
                  העתק מהשבוע הקודם
                </Button>
              </>
            )}

            {canShowApprove && (
              <>
                <Button
                  onClick={() => approveMut.mutate()}
                  disabled={approveMut.isPending}
                  size="sm"
                >
                  <CheckCircle2 className="size-4" />
                  אשר ופרסם
                </Button>
                <Button
                  onClick={() => setRejectOpen(true)}
                  size="sm"
                  variant="destructive"
                >
                  <XCircle className="size-4" />
                  דחה עם הערות
                </Button>
              </>
            )}
            {canDelete && (
              <Button
                onClick={() => setDeleteOpen(true)}
                size="sm"
                variant="destructive"
              >
                <Trash2 className="size-4" />
                מחק סידור
              </Button>
            )}
          </div>

          {/* Grid */}
          <Card className="card-elevated p-0 overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-right p-3 sticky right-0 bg-muted/50 z-10 min-w-[160px]">
                    עובד
                  </th>
                  {days.map((d, i) => (
                    <th key={d} className="p-2 text-center min-w-[110px]">
                      <div className="font-semibold">{DAY_NAMES[i]}</div>
                      <div className="text-xs text-muted-foreground">{formatHeDate(d)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(empsQ.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground">
                      אין עובדים פעילים במחלקה זו.
                    </td>
                  </tr>
                )}
                {(empsQ.data ?? []).map((emp) => (
                  <tr key={emp.id} className="border-t">
                    <td className="p-3 sticky right-0 bg-card font-medium">{emp.full_name}</td>
                    {days.map((day) => {
                      const cur = edits[emp.id]?.[day];
                      const pub = publishedMap[emp.id]?.[day] ?? null;
                      // Mark as "modified after publish" only when the schedule is approved
                      // and the current value differs from the published snapshot.
                      const isModified =
                        visible.status === "approved" &&
                        (cur ?? null) !== pub;
                      if (!editable) {
                        return (
                          <td key={day} className="p-2 text-center">
                            <div className="relative inline-block">
                              {cur ? (
                                <span
                                  className={`inline-block px-2 py-1 rounded-md text-xs font-medium ${SHIFT_CLASS[cur]} ${
                                    isModified ? "ring-2 ring-orange-500 border border-orange-500" : ""
                                  }`}
                                >
                                  {SHIFT_LABEL[cur]}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
                              )}
                              {isModified && (
                                <RefreshCw
                                  className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                                  aria-label="עודכן לאחר פרסום"
                                />
                              )}
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={day} className="p-2">
                          <div className="relative">
                            <Select
                              value={cur ?? ""}
                              onValueChange={(v) => setShift(emp.id, day, v as Shift)}
                            >
                              <SelectTrigger
                                className={`h-9 ${cur ? SHIFT_CLASS[cur] : ""} ${
                                  isModified ? "ring-2 ring-orange-500 border-orange-500" : ""
                                }`}
                              >
                                <SelectValue placeholder="—" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="morning">בוקר</SelectItem>
                                <SelectItem value="evening">ערב</SelectItem>
                                <SelectItem value="off">חופש</SelectItem>
                              </SelectContent>
                            </Select>
                            {isModified && (
                              <RefreshCw
                                className="size-3 text-orange-600 absolute -top-1 -left-1 bg-background rounded-full p-0.5 box-content border border-orange-500"
                                aria-label="עודכן לאחר פרסום"
                              />
                            )}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
        </>
      )}


      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>דחיית הסידור</DialogTitle>
          </DialogHeader>
          <Textarea
            placeholder="הערות לאחראי המחלקה (חובה)"
            value={rejectNote}
            onChange={(e) => setRejectNote(e.target.value)}
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>
              ביטול
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectNote.trim() || rejectMut.isPending}
              onClick={() => rejectMut.mutate()}
            >
              {rejectMut.isPending && <Loader2 className="size-4 animate-spin" />}
              דחה
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={copyOpen} onOpenChange={setCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>להעתיק מהשבוע הקודם?</AlertDialogTitle>
            <AlertDialogDescription>
              כל השיבוצים הנוכחיים בטיוטה יוחלפו בשיבוצי השבוע הקודם.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={() => copyMut.mutate()}>העתק</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>האם אתה בטוח שברצונך למחוק את סידור העבודה?</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק את כל השיבוצים, ההיסטוריה וההתראות של הסידור לצמיתות. לאחר המחיקה ניתן יהיה ליצור סידור חדש לאותה מחלקה ולאותו שבוע.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                deleteMut.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMut.isPending && <Loader2 className="size-4 animate-spin ml-2" />}
              מחק
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
