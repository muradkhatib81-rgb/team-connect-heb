import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fingerprint, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSingleSelect } from "@/components/searchable-picker";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { supabase } from "@/integrations/supabase/client";
import {
  attendanceErrorKey,
  attendancePunch,
  formatAttendanceHours,
  getAttendanceCapabilities,
  getAttendanceLookup,
  getMyAttendanceMonth,
  manualEditAttendanceSession,
  sessionsToExcelXml,
  softDeleteAttendanceSession,
  type AttendanceSession,
} from "@/lib/attendance.functions";

export const Route = createFileRoute("/_authenticated/attendance")({
  component: AttendancePage,
});

function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthOptions(count = 12) {
  const out: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function AttendancePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { profile } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const branchId = activeBranchId ?? profile?.branch_id ?? null;

  const capsFn = useServerFn(getAttendanceCapabilities);
  const myMonthFn = useServerFn(getMyAttendanceMonth);
  const punchFn = useServerFn(attendancePunch);
  const lookupFn = useServerFn(getAttendanceLookup);
  const deleteFn = useServerFn(softDeleteAttendanceSession);
  const editFn = useServerFn(manualEditAttendanceSession);

  const [yearMonth, setYearMonth] = useState(currentYearMonth);
  const [mgrMonth, setMgrMonth] = useState(currentYearMonth);
  const [employeeId, setEmployeeId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [editSession, setEditSession] = useState<AttendanceSession | null>(null);
  const [editIn, setEditIn] = useState("");
  const [editOut, setEditOut] = useState("");
  const [editNote, setEditNote] = useState("");

  const capsQ = useQuery({
    queryKey: ["attendance-caps", branchId],
    enabled: !!branchId,
    queryFn: () => capsFn({ data: { branchId: branchId! } }),
  });

  const myQ = useQuery({
    queryKey: ["attendance-my", branchId, yearMonth],
    enabled: !!branchId && !!capsQ.data?.show_employee_card,
    queryFn: () => myMonthFn({ data: { branchId: branchId!, yearMonth } }),
  });

  const profilesQ = useQuery({
    queryKey: ["attendance-branch-profiles", branchId],
    enabled: !!branchId && !!capsQ.data?.show_manager_card,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, id_number, department_id")
        .eq("branch_id", branchId!)
        .order("full_name");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const deptsQ = useQuery({
    queryKey: ["attendance-branch-depts", branchId],
    enabled: !!branchId && !!capsQ.data?.show_manager_card,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("departments")
        .select("id, name")
        .eq("branch_id", branchId!)
        .order("name");
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const lookupQ = useQuery({
    queryKey: ["attendance-lookup", branchId, mgrMonth, employeeId, departmentId],
    enabled: !!branchId && !!capsQ.data?.show_manager_card,
    queryFn: () =>
      lookupFn({
        data: {
          branchId: branchId!,
          yearMonth: mgrMonth,
          employeeId: employeeId || undefined,
          departmentId: departmentId || undefined,
        },
      }),
  });

  const employeeOptions = useMemo(
    () =>
      (profilesQ.data ?? []).map((p) => ({
        id: p.id,
        label: `${p.full_name ?? p.id}${p.id_number ? ` · ${p.id_number}` : ""}`,
      })),
    [profilesQ.data],
  );

  const deptOptions = useMemo(
    () =>
      (deptsQ.data ?? []).map((d) => ({
        id: d.id,
        label: d.name ?? d.id,
      })),
    [deptsQ.data],
  );

  const punchMut = useMutation({
    mutationFn: async (kind: "in" | "out") => {
      if (!branchId) throw new Error("No branch");
      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("LOCATION_REQUIRED"));
          return;
        }
        navigator.geolocation.getCurrentPosition(resolve, (err) => {
          if (err.code === err.PERMISSION_DENIED || err.code === err.POSITION_UNAVAILABLE) {
            reject(new Error("LOCATION_REQUIRED"));
            return;
          }
          reject(new Error("LOCATION_REQUIRED"));
        }, {
          enableHighAccuracy: true,
          timeout: 20000,
          maximumAge: 0,
        });
      });
      return punchFn({
        data: {
          branchId,
          kind,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        },
      });
    },
    onSuccess: (_data, kind) => {
      toast.success(kind === "in" ? t("attendance.punchedIn") : t("attendance.punchedOut"));
      void qc.invalidateQueries({ queryKey: ["attendance-my"] });
      void qc.invalidateQueries({ queryKey: ["attendance-lookup"] });
    },
    onError: (e: Error) => {
      toast.error(t(`attendance.errors.${attendanceErrorKey(e.message)}`));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (sessionId: string) => deleteFn({ data: { sessionId } }),
    onSuccess: () => {
      toast.success(t("attendance.deleted"));
      void qc.invalidateQueries({ queryKey: ["attendance-lookup"] });
      void qc.invalidateQueries({ queryKey: ["attendance-my"] });
    },
    onError: (e: Error) => toast.error(t(`attendance.errors.${attendanceErrorKey(e.message)}`)),
  });

  const editMut = useMutation({
    mutationFn: () => {
      if (!editSession) throw new Error("No session");
      return editFn({
        data: {
          sessionId: editSession.id,
          clockInAt: new Date(editIn).toISOString(),
          clockOutAt: editOut ? new Date(editOut).toISOString() : null,
          note: editNote || undefined,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("attendance.edited"));
      setEditSession(null);
      void qc.invalidateQueries({ queryKey: ["attendance-lookup"] });
      void qc.invalidateQueries({ queryKey: ["attendance-my"] });
    },
    onError: (e: Error) => toast.error(t(`attendance.errors.${attendanceErrorKey(e.message)}`)),
  });

  const openEdit = (s: AttendanceSession) => {
    setEditSession(s);
    setEditIn(toLocalInputValue(s.clock_in_at));
    setEditOut(toLocalInputValue(s.clock_out_at));
    setEditNote(s.note ?? "");
  };

  const downloadExcel = () => {
    const sessions = lookupQ.data?.sessions ?? [];
    const xml = sessionsToExcelXml(sessions);
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-${mgrMonth}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!branchId) {
    return <p className="p-4 text-sm text-muted-foreground">{t("attendance.noBranch")}</p>;
  }

  if (capsQ.isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!capsQ.data?.enabled) {
    return (
      <div className="space-y-2 p-4 md:p-6">
        <h1 className="text-xl font-semibold">{t("attendance.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("attendance.notEnabled")}</p>
      </div>
    );
  }

  if (!capsQ.data.show_employee_card && !capsQ.data.show_manager_card) {
    const reason = capsQ.data.hide_reason ?? "generic";
    const reasonKey = `attendance.hideReasons.${reason}`;
    const reasonText = t(reasonKey);
    return (
      <div className="space-y-2 p-4 md:p-6">
        <h1 className="text-xl font-semibold">{t("attendance.title")}</h1>
        <p className="text-sm text-muted-foreground">
          {reasonText === reasonKey ? t("attendance.hideReasons.generic") : reasonText}
        </p>
      </div>
    );
  }

  const open = myQ.data?.open;
  const months = monthOptions();

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Fingerprint className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{t("attendance.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("attendance.subtitle")}</p>
        </div>
      </div>

      {capsQ.data.show_employee_card && (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-semibold">{t("attendance.myHours")}</h2>
              <p className="text-sm text-muted-foreground">
                {t("attendance.monthTotal")}:{" "}
                <span className="font-medium text-foreground">
                  {formatAttendanceHours(myQ.data?.total_minutes ?? 0)}
                </span>
              </p>
            </div>
            <Select value={yearMonth} onValueChange={setYearMonth}>
              <SelectTrigger className="w-[9rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={!!open || punchMut.isPending} onClick={() => punchMut.mutate("in")}>
              {punchMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.clockIn")}
            </Button>
            <Button
              variant="secondary"
              disabled={!open || punchMut.isPending}
              onClick={() => punchMut.mutate("out")}
            >
              {punchMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.clockOut")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {open ? t("attendance.statusIn") : t("attendance.statusOut")}
          </p>

          <div className="space-y-2">
            {(myQ.data?.sessions ?? []).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span>
                  {new Date(s.clock_in_at).toLocaleString()} →{" "}
                  {s.clock_out_at
                    ? new Date(s.clock_out_at).toLocaleString()
                    : t("attendance.open")}
                </span>
                <span className="text-muted-foreground">
                  {s.duration_minutes != null ? formatAttendanceHours(s.duration_minutes) : "—"}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {capsQ.data.show_manager_card && (
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">{t("attendance.managerTitle")}</h2>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={downloadExcel}
              disabled={!lookupQ.data?.sessions?.length}
            >
              <Download className="size-3.5" />
              {t("attendance.exportExcel")}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t("attendance.month")}</Label>
              <Select value={mgrMonth} onValueChange={setMgrMonth}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("attendance.employee")}</Label>
              <SearchableSingleSelect
                options={[{ id: "__all__", label: t("attendance.allEmployees") }, ...employeeOptions]}
                value={employeeId || "__all__"}
                onChange={(v) => setEmployeeId(v === "__all__" ? "" : v)}
                placeholder={t("attendance.choose")}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("attendance.department")}</Label>
              <SearchableSingleSelect
                options={[{ id: "__all__", label: t("attendance.allDepartments") }, ...deptOptions]}
                value={departmentId || "__all__"}
                onChange={(v) => setDepartmentId(v === "__all__" ? "" : v)}
                placeholder={t("attendance.choose")}
              />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            {t("attendance.monthTotal")}:{" "}
            <span className="font-medium text-foreground">
              {formatAttendanceHours(lookupQ.data?.total_minutes ?? 0)}
            </span>
          </p>

          <div className="space-y-2">
            {(lookupQ.data?.sessions ?? []).map((s) => (
              <div
                key={s.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium">
                    {s.employee_name ?? s.user_id}
                    {s.id_number ? ` · ${s.id_number}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(s.clock_in_at).toLocaleString()} →{" "}
                    {s.clock_out_at
                      ? new Date(s.clock_out_at).toLocaleString()
                      : t("attendance.open")}
                    {s.department_name ? ` · ${s.department_name}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span>
                    {s.duration_minutes != null ? formatAttendanceHours(s.duration_minutes) : "—"}
                  </span>
                  {capsQ.data.can_edit && (
                    <Button size="sm" variant="outline" onClick={() => openEdit(s)}>
                      {t("attendance.edit")}
                    </Button>
                  )}
                  {capsQ.data.can_delete && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => deleteMut.mutate(s.id)}
                    >
                      {t("attendance.delete")}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Dialog open={!!editSession} onOpenChange={(o) => !o && setEditSession(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("attendance.editTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{t("attendance.clockIn")}</Label>
              <Input type="datetime-local" value={editIn} onChange={(e) => setEditIn(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>{t("attendance.clockOut")}</Label>
              <Input
                type="datetime-local"
                value={editOut}
                onChange={(e) => setEditOut(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("attendance.note")}</Label>
              <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditSession(null)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => editMut.mutate()} disabled={!editIn || editMut.isPending}>
              {editMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("attendance.saveEdit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
