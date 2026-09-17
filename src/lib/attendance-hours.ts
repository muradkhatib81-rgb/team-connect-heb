/**
 * Attendance hours aggregation — Asia/Jerusalem day/month bounds.
 * Shared by month totals, the hours report, and unit tests.
 */

const TZ = "Asia/Jerusalem";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const YEAR_MONTH_RE = /^\d{4}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  return DATE_RE.test(value);
}

export function isYearMonth(value: string): boolean {
  return YEAR_MONTH_RE.test(value);
}

/** Previous YYYY-MM in calendar order. */
export function previousYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  if (m === 1) return `${y - 1}-12`;
  return `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Next YYYY-MM in calendar order. */
export function nextYearMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  if (!y || !m) return yearMonth;
  if (m === 12) return `${y + 1}-01`;
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Inclusive YYYY-MM sequence from `fromYm` through `toYm`. */
export function yearMonthInclusiveRange(fromYm: string, toYm: string): string[] {
  if (!YEAR_MONTH_RE.test(fromYm) || !YEAR_MONTH_RE.test(toYm) || fromYm > toYm) return [];
  const out: string[] = [];
  let ym = fromYm;
  while (ym <= toYm) {
    out.push(ym);
    if (ym === toYm) break;
    const next = nextYearMonth(ym);
    if (next === ym) break;
    ym = next;
  }
  return out;
}

/** Next calendar date YYYY-MM-DD (UTC date arithmetic; date-only). */
export function nextIsoDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + 1));
  return dt.toISOString().slice(0, 10);
}

export function yearMonthStartDate(yearMonth: string): string {
  return `${yearMonth}-01`;
}

export function yearMonthEndDate(yearMonth: string): string {
  const [y, m] = yearMonth.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${yearMonth}-${String(last).padStart(2, "0")}`;
}

/**
 * Interpret a Jerusalem wall-clock date+time as UTC.
 * Same two-pass offset approach as `combineToIso` in date-format.ts.
 */
export function jerusalemWallClockToUtc(date: string, time: string): Date | null {
  if (!DATE_RE.test(date) || !time) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d) return null;
  let utc = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(utc)).map((p) => [p.type, p.value]),
    );
    const actual = Date.UTC(
      parseInt(parts.year, 10),
      parseInt(parts.month, 10) - 1,
      parseInt(parts.day, 10),
      parseInt(parts.hour, 10),
      parseInt(parts.minute, 10),
      0,
    );
    const desired = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, 0);
    utc += desired - actual;
  }
  return new Date(utc);
}

/** Inclusive from-date / to-date → [start, end) timestamptz in Asia/Jerusalem. */
export function jerusalemInclusiveDateRange(
  fromDate: string,
  toDate: string,
): { start: Date; end: Date } | null {
  if (!DATE_RE.test(fromDate) || !DATE_RE.test(toDate) || fromDate > toDate) return null;
  const start = jerusalemWallClockToUtc(fromDate, "00:00");
  const end = jerusalemWallClockToUtc(nextIsoDate(toDate), "00:00");
  if (!start || !end) return null;
  return { start, end };
}

export function jerusalemMonthRange(yearMonth: string): { start: Date; end: Date } | null {
  if (!YEAR_MONTH_RE.test(yearMonth)) return null;
  return jerusalemInclusiveDateRange(yearMonthStartDate(yearMonth), yearMonthEndDate(yearMonth));
}

/**
 * Seconds of a closed session that fall inside [rangeStart, rangeEnd).
 * Open sessions (no clock-out) contribute 0 — they are not finished work.
 */
export function clippedSessionSeconds(args: {
  clockInAt: string | Date;
  clockOutAt: string | Date | null | undefined;
  rangeStart: Date;
  rangeEnd: Date;
}): number {
  if (args.clockOutAt == null || args.clockOutAt === "") return 0;
  const clockIn = args.clockInAt instanceof Date ? args.clockInAt : new Date(args.clockInAt);
  const clockOut = args.clockOutAt instanceof Date ? args.clockOutAt : new Date(args.clockOutAt);
  if (Number.isNaN(clockIn.getTime()) || Number.isNaN(clockOut.getTime())) return 0;
  if (clockOut.getTime() < clockIn.getTime()) return 0;
  const clippedIn = Math.max(clockIn.getTime(), args.rangeStart.getTime());
  const clippedOut = Math.min(clockOut.getTime(), args.rangeEnd.getTime());
  if (clippedOut <= clippedIn) return 0;
  return (clippedOut - clippedIn) / 1000;
}

/** Round to nearest minute, matching report RPC ROUND(epoch/60). */
export function secondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 60);
}

/** Hours with 2 decimal places from exact seconds (not from rounded minutes). */
export function secondsToHours(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round((seconds / 3600) * 100) / 100;
}

export function estimatedPayFromSeconds(seconds: number, hourlyRate: number | null | undefined): number | null {
  if (hourlyRate == null || !Number.isFinite(hourlyRate)) return null;
  const hours = secondsToHours(seconds);
  return Math.round(hours * hourlyRate * 100) / 100;
}

export const PAY_ADJUSTMENT_TYPES = ["deduct_work_day", "deduct_amount", "add_amount"] as const;
export type PayAdjustmentType = (typeof PAY_ADJUSTMENT_TYPES)[number];
export const REFERENCE_WORK_DAY_HOURS = 8;

export function isPayAdjustmentType(value: string | null | undefined): value is PayAdjustmentType {
  return !!value && (PAY_ADJUSTMENT_TYPES as readonly string[]).includes(value);
}

/** Suggested deduct-work-day amount: hourly rate × 8 (reference day). */
export function suggestedWorkDayDeduction(
  hourlyRate: number | null | undefined,
  hours = REFERENCE_WORK_DAY_HOURS,
): number | null {
  if (hourlyRate == null || !Number.isFinite(hourlyRate) || hourlyRate < 0) return null;
  return Math.round(hourlyRate * hours * 100) / 100;
}

/** Amount is stored positive; sign comes from type (add vs deduct). */
export function adjustmentSignedAmount(type: PayAdjustmentType, amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const abs = Math.round(amount * 100) / 100;
  return type === "add_amount" ? abs : -abs;
}

export function sumAdjustmentSignedAmounts(
  rows: Array<{ type: PayAdjustmentType; amount: number }>,
): number {
  const net = rows.reduce((sum, r) => sum + adjustmentSignedAmount(r.type, r.amount), 0);
  return Math.round(net * 100) / 100;
}

/**
 * Hours×rate folded with the ledger: − deductions + additions.
 * No rate and no adjustments → null. Adjustments alone still produce a total.
 */
export function estimatedPayWithAdjustments(
  hoursPay: number | null | undefined,
  adjustmentNet: number,
): number | null {
  const adj = Number.isFinite(adjustmentNet) ? adjustmentNet : 0;
  if ((hoursPay == null || !Number.isFinite(hoursPay)) && adj === 0) return null;
  return Math.round(((hoursPay ?? 0) + adj) * 100) / 100;
}

/**
 * Single-adjustment cap. Platform Owner is unlimited.
 * Grantees without a positive max cannot post.
 */
export function adjustmentExceedsCap(args: {
  amount: number;
  maxAmount: number | null | undefined;
  isPlatformOwner: boolean;
}): boolean {
  if (args.isPlatformOwner) return false;
  if (!Number.isFinite(args.amount) || args.amount <= 0) return true;
  const max = args.maxAmount;
  if (max == null || !Number.isFinite(max) || max <= 0) return true;
  return args.amount > max + 1e-9;
}

/**
 * Employee profile hours/adjustments block: punch card OR any own ledger row.
 * Managers cannot use this to view someone else.
 */
export function profileHoursBlockVisible(
  punchCardVisible: boolean,
  hasOwnAdjustments: boolean,
): boolean {
  return punchCardVisible || hasOwnAdjustments;
}

/**
 * Adjustments on the hours report use the same audience as running the report
 * (Platform Owner or can_report). Creating adjustments is a separate grant.
 */
export function hoursReportIncludesAdjustments(canRunHoursReport: boolean): boolean {
  return canRunHoursReport;
}

/**
 * Profile MUST list that employee's deductions/additions with type labels.
 * Selected-month rows stay tied to estimated pay; other months still appear
 * so a current-month view cannot hide an earlier deduction.
 */
export function splitProfileAdjustments<T extends { id: string; year_month?: string }>(args: {
  selectedYearMonth: string;
  monthAdjustments: T[];
  allAdjustments: T[];
}): { selectedMonth: T[]; otherMonths: T[] } {
  const fromAll = args.allAdjustments.filter((row) => row.year_month === args.selectedYearMonth);
  const selectedMonth = args.monthAdjustments.length > 0 ? args.monthAdjustments : fromAll;
  const selectedIds = new Set(selectedMonth.map((row) => row.id).filter(Boolean));
  const otherMonths = args.allAdjustments.filter((row) => {
    if (selectedIds.has(row.id)) return false;
    return row.year_month !== args.selectedYearMonth;
  });
  return { selectedMonth, otherMonths };
}

export function formatAttendanceHoursFromSeconds(seconds: number): string {
  const minutes = secondsToMinutes(seconds);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function sessionOverlapsRange(args: {
  clockInAt: string | Date;
  clockOutAt: string | Date | null | undefined;
  rangeStart: Date;
  rangeEnd: Date;
}): boolean {
  const clockIn = args.clockInAt instanceof Date ? args.clockInAt : new Date(args.clockInAt);
  if (Number.isNaN(clockIn.getTime()) || clockIn.getTime() >= args.rangeEnd.getTime()) return false;
  if (args.clockOutAt == null || args.clockOutAt === "") {
    return clockIn.getTime() < args.rangeEnd.getTime();
  }
  const clockOut = args.clockOutAt instanceof Date ? args.clockOutAt : new Date(args.clockOutAt);
  if (Number.isNaN(clockOut.getTime())) return false;
  return clockOut.getTime() > args.rangeStart.getTime();
}

/** YYYY-MM of "now" in Asia/Jerusalem (not the browser's local zone). */
export function currentJerusalemYearMonth(now: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

export function jerusalemMonthOptions(count = 12, now: Date = new Date()): string[] {
  const current = currentJerusalemYearMonth(now);
  const out: string[] = [current];
  let ym = current;
  for (let i = 1; i < count; i++) {
    ym = previousYearMonth(ym);
    out.push(ym);
  }
  return out;
}

/** YYYY-MM of an instant in Asia/Jerusalem. */
export function jerusalemYearMonthOf(instant: string | Date): string | null {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) return null;
  return currentJerusalemYearMonth(d);
}

export type HoursHistorySession = {
  clockInAt: string | Date;
  clockOutAt: string | Date | null | undefined;
};

/**
 * Jerusalem months in which a closed session has clipped seconds > 0.
 * Open sessions contribute none (they are not finished work).
 * A punch that crosses 00:00 on the 1st appears in both months.
 */
export function yearMonthsWithClippedHours(session: HoursHistorySession): string[] {
  if (session.clockOutAt == null || session.clockOutAt === "") return [];
  const startYm = jerusalemYearMonthOf(session.clockInAt);
  const endYm = jerusalemYearMonthOf(session.clockOutAt);
  if (!startYm || !endYm) return [];
  const from = startYm <= endYm ? startYm : endYm;
  const to = startYm <= endYm ? endYm : startYm;
  return yearMonthInclusiveRange(from, to).filter((ym) => {
    const range = jerusalemMonthRange(ym);
    if (!range) return false;
    return (
      clippedSessionSeconds({
        clockInAt: session.clockInAt,
        clockOutAt: session.clockOutAt,
        rangeStart: range.start,
        rangeEnd: range.end,
      }) > 0
    );
  });
}

/** Sum clipped closed-session seconds for one Jerusalem calendar month. */
export function sumClippedSecondsForMonth(
  sessions: HoursHistorySession[],
  yearMonth: string,
): number {
  const range = jerusalemMonthRange(yearMonth);
  if (!range) return 0;
  return sessions.reduce(
    (sum, s) =>
      sum +
      clippedSessionSeconds({
        clockInAt: s.clockInAt,
        clockOutAt: s.clockOutAt,
        rangeStart: range.start,
        rangeEnd: range.end,
      }),
    0,
  );
}

/**
 * Profile hours picker: current Jerusalem month is always present (resets
 * at month start even if this month has 0 hours). Previous months stay if
 * they have closed clipped hours. Newest first. Live from sessions — not a cache.
 */
export function listProfileHoursMonths(
  sessions: HoursHistorySession[],
  now: Date = new Date(),
): string[] {
  const current = currentJerusalemYearMonth(now);
  const set = new Set<string>([current]);
  for (const s of sessions) {
    for (const ym of yearMonthsWithClippedHours(s)) set.add(ym);
  }
  return [...set].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}

export type HoursReportFilter = "all" | "punchers" | "one" | "employees";

/** One employee in the hours-report population (branch/company already scoped). */
export type HoursReportPerson = {
  userId: string;
  departmentId: string | null;
  seconds: number;
  hourlyRate: number | null;
};

export function normalizeIdList(
  ids?: Array<string | null | undefined> | null,
  singleId?: string | null,
): string[] {
  const fromArray = (ids ?? []).filter((id): id is string => !!id);
  const merged = fromArray.length > 0 ? fromArray : singleId ? [singleId] : [];
  return [...new Set(merged)];
}

/** Unique non-empty department ids. Empty means “all departments”. */
export function normalizeDepartmentIds(
  departmentIds?: Array<string | null | undefined> | null,
  departmentId?: string | null,
): string[] {
  return normalizeIdList(departmentIds, departmentId);
}

export function normalizeEmployeeIds(
  employeeIds?: Array<string | null | undefined> | null,
  employeeId?: string | null,
): string[] {
  return normalizeIdList(employeeIds, employeeId);
}

/** Label used in the hours-report employee picker: name · national ID. */
export function employeePickerLabel(
  fullName: string | null | undefined,
  idNumber: string | null | undefined,
): string {
  const name = (fullName ?? "").trim();
  const id = (idNumber ?? "").trim();
  if (name && id) return `${name} · ${id}`;
  return name || id;
}

/** Search matches full name or national ID number (case-insensitive). */
export function employeeMatchesPickerQuery(
  fullName: string | null | undefined,
  idNumber: string | null | undefined,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const name = (fullName ?? "").toLowerCase();
  const id = (idNumber ?? "").toLowerCase();
  return name.includes(q) || id.includes(q);
}

export function personMatchesDepartments(
  departmentId: string | null | undefined,
  selectedDepartmentIds?: Array<string | null | undefined> | null,
): boolean {
  const ids = normalizeDepartmentIds(selectedDepartmentIds);
  if (ids.length === 0) return true;
  return !!departmentId && ids.includes(departmentId);
}

export function personMatchesDepartment(
  departmentId: string | null | undefined,
  selectedDepartmentId: string | null | undefined,
): boolean {
  return personMatchesDepartments(departmentId, selectedDepartmentId ? [selectedDepartmentId] : []);
}

export function isEmployeeSelectionFilter(filter: HoursReportFilter): boolean {
  return filter === "one" || filter === "employees";
}

/**
 * Apply punchers/all/one/employees plus optional live department filter.
 * Explicit employee multi-select is the primary filter (can mix departments).
 * Department match uses the employee's current assignment when not selecting people.
 */
export function filterHoursReportPeople(args: {
  people: HoursReportPerson[];
  filter: HoursReportFilter;
  departmentId?: string | null;
  departmentIds?: Array<string | null | undefined> | null;
  employeeId?: string | null;
  employeeIds?: Array<string | null | undefined> | null;
}): HoursReportPerson[] {
  const employeeIds = normalizeEmployeeIds(args.employeeIds, args.employeeId);
  const departmentIds = normalizeDepartmentIds(args.departmentIds, args.departmentId);
  return args.people.filter((p) => {
    if (isEmployeeSelectionFilter(args.filter)) {
      return employeeIds.includes(p.userId);
    }
    if (!personMatchesDepartments(p.departmentId, departmentIds)) return false;
    if (args.filter === "punchers") return p.seconds > 0;
    return true;
  });
}

export type HoursReportDepartmentTotal = {
  departmentId: string | null;
  total_seconds: number;
  total_minutes: number;
  total_hours: number;
  estimated_pay: number;
};

/** Optional per-department subtotals for a multi-select set. */
export function sumHoursReportTotalsByDepartment(people: HoursReportPerson[]): HoursReportDepartmentTotal[] {
  const byDept = new Map<string | null, HoursReportPerson[]>();
  for (const p of people) {
    const key = p.departmentId ?? null;
    const list = byDept.get(key);
    if (list) list.push(p);
    else byDept.set(key, [p]);
  }
  return [...byDept.entries()].map(([departmentId, rows]) => ({
    departmentId,
    ...sumHoursReportTotals(rows),
  }));
}

/** Totals for a filtered set (department footer or whole-scope footer). */
export function sumHoursReportTotals(people: HoursReportPerson[]): {
  total_seconds: number;
  total_minutes: number;
  total_hours: number;
  estimated_pay: number;
} {
  const total_seconds = people.reduce((sum, p) => sum + Math.max(0, p.seconds), 0);
  const estimated_pay = people.reduce((sum, p) => {
    const pay = estimatedPayFromSeconds(p.seconds, p.hourlyRate);
    return sum + (pay ?? 0);
  }, 0);
  return {
    total_seconds,
    total_minutes: secondsToMinutes(total_seconds),
    total_hours: secondsToHours(total_seconds),
    estimated_pay: Math.round(estimated_pay * 100) / 100,
  };
}
