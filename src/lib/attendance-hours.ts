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

export type HoursReportFilter = "all" | "punchers" | "one";

/** One employee in the hours-report population (branch/company already scoped). */
export type HoursReportPerson = {
  userId: string;
  departmentId: string | null;
  seconds: number;
  hourlyRate: number | null;
};

/** Unique non-empty department ids. Empty means “all departments”. */
export function normalizeDepartmentIds(
  departmentIds?: Array<string | null | undefined> | null,
  departmentId?: string | null,
): string[] {
  const fromArray = (departmentIds ?? []).filter((id): id is string => !!id);
  const merged = fromArray.length > 0 ? fromArray : departmentId ? [departmentId] : [];
  return [...new Set(merged)];
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

/**
 * Apply punchers/all/one plus optional live department filter (one or many).
 * Department match uses the employee's current department assignment.
 * An empty department list means all departments in the already-scoped population.
 */
export function filterHoursReportPeople(args: {
  people: HoursReportPerson[];
  filter: HoursReportFilter;
  departmentId?: string | null;
  departmentIds?: Array<string | null | undefined> | null;
  employeeId?: string | null;
}): HoursReportPerson[] {
  const departmentIds = normalizeDepartmentIds(args.departmentIds, args.departmentId);
  return args.people.filter((p) => {
    if (!personMatchesDepartments(p.departmentId, departmentIds)) return false;
    if (args.filter === "one") {
      return !!args.employeeId && p.userId === args.employeeId;
    }
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
