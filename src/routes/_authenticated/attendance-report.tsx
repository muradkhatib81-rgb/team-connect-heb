import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ClipboardList, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableMultiSelect, SearchableSingleSelect } from "@/components/searchable-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  attendanceErrorKey,
  formatAttendanceHours,
  getAttendanceHoursReport,
  hoursReportToExcelXml,
  listAttendanceReportDepartments,
  listAttendanceReportEmployees,
  listAttendanceReportScopes,
  type AttendanceReportScope,
} from "@/lib/attendance.functions";
import { employeePickerLabel, currentJerusalemYearMonth, yearMonthStartDate } from "@/lib/attendance-hours";

/** Hours report UI. Access is gated by listAttendanceReportScopes (can_report grant / PO), not roles. */

export const Route = createFileRoute("/_authenticated/attendance-report")({
  component: AttendanceHoursReportPage,
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

function AttendanceHoursReportPage() {
  const { t } = useTranslation();
  const scopesFn = useServerFn(listAttendanceReportScopes);
  const employeesFn = useServerFn(listAttendanceReportEmployees);
  const departmentsFn = useServerFn(listAttendanceReportDepartments);
  const reportFn = useServerFn(getAttendanceHoursReport);

  const [scopeId, setScopeId] = useState("");
  const [fromDate, setFromDate] = useState(() => yearMonthStartDate(currentJerusalemYearMonth()));
  const [toDate, setToDate] = useState(() => jerusalemToday());
  const [filter, setFilter] = useState<"all" | "punchers" | "employees">("punchers");
  const [employeeIds, setEmployeeIds] = useState<string[]>([]);
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [runKey, setRunKey] = useState(0);

  const scopesQ = useQuery({
    queryKey: ["attendance-report-scopes"],
    queryFn: () => scopesFn(),
  });

  const scopes = scopesQ.data?.scopes ?? [];
  const selected = scopes.find((s) => scopeKey(s) === scopeId) ?? null;

  const departmentsQ = useQuery({
    queryKey: ["attendance-report-departments", selected?.branch_id, selected?.company_id],
    enabled: !!selected,
    queryFn: () =>
      departmentsFn({
        data: {
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
        },
      }),
  });

  const employeesQ = useQuery({
    queryKey: [
      "attendance-report-employees",
      selected?.branch_id,
      selected?.company_id,
      departmentIds,
    ],
    enabled: !!selected && filter === "employees",
    queryFn: () =>
      employeesFn({
        data: {
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
          departmentIds: departmentIds.length ? departmentIds : undefined,
        },
      }),
  });

  useEffect(() => {
    const rows = employeesQ.data;
    if (!rows) return;
    const allowed = new Set(rows.map((p) => p.id));
    setEmployeeIds((prev) => {
      const next = prev.filter((id) => allowed.has(id));
      return next.length === prev.length && next.every((id, i) => id === prev[i]) ? prev : next;
    });
  }, [employeesQ.data]);

  const reportQ = useQuery({
    queryKey: [
      "attendance-hours-report",
      runKey,
      selected?.branch_id,
      selected?.company_id,
      fromDate,
      toDate,
      filter,
      employeeIds,
      departmentIds,
    ],
    enabled:
      runKey > 0 &&
      !!selected &&
      fromDate <= toDate &&
      (filter !== "employees" || employeeIds.length > 0),
    queryFn: () =>
      reportFn({
        data: {
          from: fromDate,
          to: toDate,
          branchId: selected?.branch_id ?? undefined,
          companyId: selected?.company_id ?? undefined,
          filter,
          employeeIds: filter === "employees" ? employeeIds : undefined,
          departmentIds: departmentIds.length ? departmentIds : undefined,
        },
      }),
  });

  const scopeOptions = useMemo(
    () =>
      scopes.map((s) => ({
        id: scopeKey(s),
        label: s.branch_id
          ? `${s.company_name ?? ""} · ${s.branch_name ?? s.branch_id}`
          : `${s.company_name ?? s.company_id} · ${t("attendance.wholeCompany")}`,
      })),
    [scopes, t],
  );

  const employeeOptions = useMemo(
    () =>
      (employeesQ.data ?? []).map((p) => ({
        id: p.id,
        label: employeePickerLabel(p.full_name ?? p.id, p.id_number),
        sublabel: p.id_number ?? undefined,
      })),
    [employeesQ.data],
  );

  const departmentOptions = useMemo(
    () =>
      (departmentsQ.data ?? []).map((d) => ({
        id: d.id,
        label: d.name,
      })),
    [departmentsQ.data],
  );

  const selectedDepartmentNames = useMemo(() => {
    const fromReport = (reportQ.data?.departments ?? []).map((d) => d.name).filter(Boolean);
    if (fromReport.length) return fromReport;
    const byId = new Map((departmentsQ.data ?? []).map((d) => [d.id, d.name]));
    return departmentIds.map((id) => byId.get(id)).filter((n): n is string => !!n);
  }, [reportQ.data?.departments, departmentsQ.data, departmentIds]);

  const selectedSetLabel =
    selectedDepartmentNames.length === 1
      ? selectedDepartmentNames[0]
      : selectedDepartmentNames.length > 1
        ? selectedDepartmentNames.join(" · ")
        : null;

  const isEmployeeFilter = filter === "employees" || reportQ.data?.filter === "employees";

  const totalsLabel = isEmployeeFilter
    ? t("attendance.selectedEmployeesTotals")
    : selectedDepartmentNames.length === 1
      ? t("attendance.departmentTotalsNamed", { name: selectedDepartmentNames[0] })
      : selectedDepartmentNames.length > 1
        ? t("attendance.selectedDepartmentsTotals")
        : t("attendance.totals");

  const showDeptSubtotals =
    (isEmployeeFilter || departmentIds.length > 1) &&
    (reportQ.data?.department_totals ?? []).length > 1;

  const downloadExcel = () => {
    const report = reportQ.data;
    if (!report?.rows?.length) return;
    const xml = hoursReportToExcelXml(report);
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `attendance-hours-${fromDate}-${toDate}.xls`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runReport = () => {
    if (!selected) {
      toast.error(t("attendance.chooseScope"));
      return;
    }
    if (fromDate > toDate) {
      toast.error(t(`attendance.errors.invalidRange`));
      return;
    }
    if (filter === "employees" && employeeIds.length === 0) {
      toast.error(t(`attendance.errors.employeeRequired`));
      return;
    }
    setRunKey((k) => k + 1);
  };

  if (scopesQ.isLoading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!scopesQ.data?.can_report) {
    return (
      <div className="space-y-2 p-4 md:p-6">
        <h1 className="text-xl font-semibold">{t("attendance.reportTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("attendance.reportForbidden")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-start gap-3">
        <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <ClipboardList className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{t("attendance.reportTitle")}</h1>
          <p className="text-sm text-muted-foreground">{t("attendance.reportSubtitle")}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("attendance.reportDeptHint")}</p>
          <Link to="/attendance" className="mt-1 inline-block text-xs text-primary hover:underline">
            {t("attendance.backToPunch")}
          </Link>
        </div>
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5">
            <Label>{t("attendance.reportScope")}</Label>
            <SearchableSingleSelect
              options={scopeOptions}
              value={scopeId}
              onChange={(v) => {
                setScopeId(v);
                setEmployeeIds([]);
                setDepartmentIds([]);
              }}
              placeholder={t("attendance.choose")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.fromDate")}</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.toDate")}</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.departments")}</Label>
            <SearchableMultiSelect
              options={departmentOptions}
              value={departmentIds}
              onChange={(ids) => {
                setDepartmentIds(ids);
              }}
              disabled={!selected}
              placeholder={t("attendance.allDepartments")}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("attendance.employeeFilter")}</Label>
            <Select
              value={filter}
              onValueChange={(v) => {
                setFilter(v as "all" | "punchers" | "employees");
                if (v !== "employees") setEmployeeIds([]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="punchers">{t("attendance.filterPunchers")}</SelectItem>
                <SelectItem value="all">{t("attendance.filterAll")}</SelectItem>
                <SelectItem value="employees">{t("attendance.filterEmployees")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {filter === "employees" ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t("attendance.employees")}</Label>
              <SearchableMultiSelect
                options={employeeOptions}
                value={employeeIds}
                onChange={setEmployeeIds}
                disabled={!selected}
                placeholder={t("attendance.chooseEmployees")}
                searchPlaceholder={t("attendance.searchEmployees")}
              />
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runReport} disabled={!scopeId || reportQ.isFetching}>
            {reportQ.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
            {t("attendance.runReport")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={downloadExcel}
            disabled={!reportQ.data?.rows?.length}
          >
            <Download className="size-3.5" />
            {t("attendance.exportExcel")}
          </Button>
        </div>
        {reportQ.isError ? (
          <p className="text-sm text-destructive">
            {t(`attendance.errors.${attendanceErrorKey((reportQ.error as Error).message)}`)}
          </p>
        ) : null}
      </Card>

      {runKey > 0 && reportQ.data ? (
        <Card className="overflow-hidden p-0">
          {selectedSetLabel || isEmployeeFilter ? (
            <div className="border-b px-4 py-3">
              <p className="text-sm font-medium">
                {isEmployeeFilter
                  ? t("attendance.selectedEmployeesCaption")
                  : selectedSetLabel}
              </p>
              <p className="text-xs text-muted-foreground">
                {isEmployeeFilter
                  ? t("attendance.employeesReportCaption")
                  : departmentIds.length > 1
                    ? t("attendance.departmentsReportCaption")
                    : t("attendance.departmentReportCaption")}
              </p>
            </div>
          ) : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("attendance.employee")}</TableHead>
                <TableHead>{t("attendance.hoursCol")}</TableHead>
                <TableHead>{t("attendance.hourlyRate")}</TableHead>
                <TableHead>{t("attendance.estimatedPay")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reportQ.data.rows ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground">
                    {t("attendance.reportEmpty")}
                  </TableCell>
                </TableRow>
              ) : (
                reportQ.data.rows.map((row) => (
                  <TableRow key={row.user_id}>
                    <TableCell>
                      <div className="font-medium">{row.full_name ?? row.user_id}</div>
                      {row.id_number ? (
                        <div className="text-xs text-muted-foreground">{row.id_number}</div>
                      ) : null}
                      {(isEmployeeFilter || departmentIds.length !== 1) && row.department_name ? (
                        <div className="text-xs text-muted-foreground">{row.department_name}</div>
                      ) : null}
                      {(row.adjustments ?? []).length > 0 ? (
                        <ul className="mt-1 space-y-0.5">
                          {row.adjustments!.map((a) => (
                            <li key={a.id} className="text-xs text-muted-foreground">
                              {t(`attendance.adjustmentTypes.${a.type}`)}
                              {": "}
                              {formatMoney(a.signed_amount)}
                              {a.adjustment_date ? ` · ${a.adjustment_date}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </TableCell>
                    <TableCell>{formatAttendanceHours(row.total_minutes ?? 0)}</TableCell>
                    <TableCell>
                      {row.hourly_rate == null ? t("attendance.rateUnset") : formatMoney(row.hourly_rate)}
                    </TableCell>
                    <TableCell>
                      {row.estimated_pay == null ? "—" : formatMoney(row.estimated_pay)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            <TableFooter>
              {showDeptSubtotals
                ? (reportQ.data.department_totals ?? []).map((d) => (
                    <TableRow key={d.department_id ?? "none"}>
                      <TableCell className="font-normal text-muted-foreground">
                        {t("attendance.departmentTotalsNamed", {
                          name: d.department_name ?? t("attendance.department"),
                        })}
                      </TableCell>
                      <TableCell className="font-normal text-muted-foreground">
                        {formatAttendanceHours(d.total_minutes ?? 0)}
                      </TableCell>
                      <TableCell />
                      <TableCell className="font-normal text-muted-foreground">
                        {formatMoney(d.estimated_pay ?? 0)}
                      </TableCell>
                    </TableRow>
                  ))
                : null}
              <TableRow>
                <TableCell>{totalsLabel}</TableCell>
                <TableCell>{formatAttendanceHours(reportQ.data.totals.total_minutes ?? 0)}</TableCell>
                <TableCell />
                <TableCell>{formatMoney(reportQ.data.totals.estimated_pay ?? 0)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </Card>
      ) : null}
    </div>
  );
}
