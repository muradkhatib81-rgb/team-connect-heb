import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSingleSelect } from "@/components/searchable-picker";
import {
  attendanceErrorKey,
  createAttendancePayAdjustment,
  listAttendanceAdjustEmployees,
  listAttendanceAdjustScopes,
  listAttendancePayAdjustments,
  type AttendanceReportScope,
} from "@/lib/attendance.functions";
import {
  employeePickerLabel,
  suggestedWorkDayDeduction,
  type PayAdjustmentType,
} from "@/lib/attendance-hours";

/** Pay adjustments UI. Create access is PO or can_adjust_pay grant — not roles. */
export const Route = createFileRoute("/_authenticated/attendance-adjustments")({
  component: AttendanceAdjustmentsPage,
});

function jerusalemToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function scopeKey(s: AttendanceReportScope): string {
  return s.branch_id ? `b:${s.branch_id}` : `c:${s.company_id ?? ""}`;
}

function formatMoney(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function AttendanceAdjustmentsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const scopesFn = useServerFn(listAttendanceAdjustScopes);
  const employeesFn = useServerFn(listAttendanceAdjustEmployees);
  const listFn = useServerFn(listAttendancePayAdjustments);
  const createFn = useServerFn(createAttendancePayAdjustment);

  const [scopeId, setScopeId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [adjType, setAdjType] = useState<PayAdjustmentType>("deduct_amount");
  const [amount, setAmount] = useState("");
  const [adjDate, setAdjDate] = useState(jerusalemToday);
  const [note, setNote] = useState("");

  const scopesQ = useQuery({
    queryKey: ["attendance-adjust-scopes"],
    queryFn: () => scopesFn(),
  });
  const scopes = scopesQ.data?.scopes ?? [];
  const selected = scopes.find((s) => scopeKey(s) === scopeId) ?? null;

  useEffect(() => {
    if (!scopeId && scopes.length === 1) setScopeId(scopeKey(scopes[0]));
  }, [scopeId, scopes]);

  const employeesQ = useQuery({
    queryKey: ["attendance-adjust-employees", selected?.branch_id, selected?.company_id],
    enabled: !!selected && !!scopesQ.data?.can_adjust_pay,
    queryFn: () =>
      employeesFn({
        data: {
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
        },
      }),
  });

  const recentQ = useQuery({
    queryKey: ["attendance-adjust-recent", selected?.branch_id, selected?.company_id],
    enabled: !!selected && !!scopesQ.data?.can_adjust_pay,
    queryFn: () =>
      listFn({
        data: {
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
        },
      }),
  });

  const employees = employeesQ.data ?? [];
  const selectedEmp = employees.find((e) => e.id === employeeId) ?? null;
  const suggested = selectedEmp
    ? selectedEmp.suggested_day_amount ?? suggestedWorkDayDeduction(selectedEmp.hourly_rate)
    : null;
  const scopeMax =
    (selected as { adjust_pay_max_amount?: number | null } | null)?.adjust_pay_max_amount ??
    scopesQ.data?.adjust_pay_max_amount ??
    null;

  useEffect(() => {
    if (adjType === "deduct_work_day" && suggested != null) {
      setAmount(String(suggested));
    }
  }, [adjType, suggested, employeeId]);

  const employeeOptions = useMemo(
    () =>
      employees.map((e) => ({
        id: e.id,
        label: employeePickerLabel(e.full_name, e.id_number) || e.id,
      })),
    [employees],
  );

  const createMut = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          employeeId,
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
          type: adjType,
          amount: Number(amount),
          adjustmentDate: adjDate,
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => {
      toast.success(t("attendance.adjustmentSaved"));
      setNote("");
      void qc.invalidateQueries({ queryKey: ["attendance-adjust-recent"] });
      void qc.invalidateQueries({ queryKey: ["attendance-profile-hours"] });
      void qc.invalidateQueries({ queryKey: ["attendance-hours-report"] });
    },
    onError: (e: Error) => {
      toast.error(t(`attendance.errors.${attendanceErrorKey(e.message)}`));
    },
  });

  if (scopesQ.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!scopesQ.data?.can_adjust_pay) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <p className="text-sm text-muted-foreground">{t("attendance.adjustForbidden")}</p>
        <Button asChild variant="outline">
          <Link to="/attendance">{t("attendance.backToPunch")}</Link>
        </Button>
      </div>
    );
  }

  const amountNum = Number(amount);
  const canSubmit =
    !!selected &&
    !!employeeId &&
    Number.isFinite(amountNum) &&
    amountNum > 0 &&
    !!adjDate &&
    !createMut.isPending;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Banknote className="size-5" />
        </div>
        <div>
          <h1 className="text-xl font-semibold">{t("attendance.adjustTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("attendance.adjustSubtitle")}</p>
        </div>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>{t("attendance.reportScope")}</Label>
            <SearchableSingleSelect
              options={scopes.map((s) => ({
                id: scopeKey(s),
                label: s.branch_id
                  ? `${s.company_name ?? ""} · ${s.branch_name ?? s.branch_id}`
                  : (s.company_name ?? t("attendance.wholeCompany")),
              }))}
              value={scopeId}
              onChange={(v) => {
                setScopeId(v);
                setEmployeeId("");
              }}
              placeholder={t("attendance.chooseScope")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.employee")}</Label>
            <SearchableSingleSelect
              options={employeeOptions}
              value={employeeId}
              onChange={setEmployeeId}
              disabled={!selected}
              placeholder={t("attendance.searchEmployees")}
              searchPlaceholder={t("attendance.searchEmployees")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.adjustmentType")}</Label>
            <Select value={adjType} onValueChange={(v) => setAdjType(v as PayAdjustmentType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="deduct_work_day">{t("attendance.adjustmentTypes.deduct_work_day")}</SelectItem>
                <SelectItem value="deduct_amount">{t("attendance.adjustmentTypes.deduct_amount")}</SelectItem>
                <SelectItem value="add_amount">{t("attendance.adjustmentTypes.add_amount")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.adjustmentAmount")}</Label>
            <Input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
            {adjType === "deduct_work_day" && suggested != null ? (
              <p className="text-xs text-muted-foreground">
                {t("attendance.adjustWorkDayHint", { amount: formatMoney(suggested) })}
              </p>
            ) : null}
            {scopeMax != null ? (
              <p className="text-xs text-muted-foreground">
                {t("attendance.adjustCapHint", { max: formatMoney(scopeMax) })}
              </p>
            ) : null}
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.adjustmentDate")}</Label>
            <Input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>{t("attendance.adjustmentNote")}</Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={2}
            />
          </div>
        </div>
        <Button onClick={() => createMut.mutate()} disabled={!canSubmit}>
          {createMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          {t("attendance.saveAdjustment")}
        </Button>
      </Card>

      <div className="space-y-2">
        <h2 className="font-semibold">{t("attendance.recentAdjustments")}</h2>
        <p className="text-xs text-muted-foreground">{t("attendance.adjustRecentHint")}</p>
        {recentQ.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : (recentQ.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("attendance.noAdjustments")}</p>
        ) : (
          (recentQ.data ?? []).map((row) => (
            <Card key={row.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {row.full_name ?? row.employee_id}
                  {row.id_number ? ` · ${row.id_number}` : ""}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t(`attendance.adjustmentTypes.${row.type}`)} · {row.adjustment_date}
                  {row.note ? ` · ${row.note}` : ""}
                </p>
              </div>
              <span className="tabular-nums font-semibold">{formatMoney(row.signed_amount)}</span>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
