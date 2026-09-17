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
