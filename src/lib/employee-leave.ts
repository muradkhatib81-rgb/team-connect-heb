/** Profile fields used to decide if an employee is on leave on a calendar day (YYYY-MM-DD). */
export type LeaveTypeCode = "regular" | "sick";

export type EmployeeLeaveFields = {
  on_leave?: boolean | null;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
  leave_type_code?: LeaveTypeCode | string | null;
};

function dayOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

function todayIsoJerusalem(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** True when the employee should be treated as on leave (חופש) for schedule purposes on `dayDate`. */
export function isEmployeeOnLeaveOnDate(
  emp: EmployeeLeaveFields,
  dayDate: string,
): boolean {
  const start = dayOnly(emp.leave_start_date);
  const end = dayOnly(emp.leave_end_date);
  if (start && end) return dayDate >= start && dayDate <= end;
  if (!emp.on_leave) return false;
  if (start) return dayDate >= start;
  if (end) return dayDate <= end;
  // Legacy rows: on_leave without dates → treat whole schedule week as leave.
  return true;
}

/** True when the employee is on leave today (date-aware; uses Jerusalem calendar day). */
export function isEmployeeCurrentlyOnLeave(
  emp: EmployeeLeaveFields,
  dayDate?: string,
): boolean {
  return isEmployeeOnLeaveOnDate(emp, dayDate ?? todayIsoJerusalem());
}

/** Override stored shift with חופש when the employee is on leave that day. */
export function effectiveScheduleShift<T extends string | null | undefined>(
  emp: EmployeeLeaveFields,
  dayDate: string,
  shift: T,
): T | "off" {
  if (isEmployeeOnLeaveOnDate(emp, dayDate)) return "off";
  return shift;
}

/** Schedule card label for leave days — same wording for manual + request paths. */
export function leaveOffLabel(code: LeaveTypeCode | string | null | undefined): string {
  if (code === "sick") return "חופש מחלה";
  if (code === "regular") return "חופש רגיל";
  return "חופש";
}

/** Single calendar day as Hebrew short date (Latin digits, Gregorian). */
export function formatLeaveDay(value: string | null | undefined): string {
  const day = dayOnly(value ?? null);
  if (!day) return "—";
  // Parse as noon local to avoid UTC day-shift on date-only strings.
  const d = new Date(`${day}T12:00:00`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(d);
}

/** Date+time for leave approval / audit display (Jerusalem). */
export function formatLeaveDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
    calendar: "gregory",
    hour12: false,
  }).format(d);
}

/**
 * Active approved leave (still within dates) → red.
 * Ended period, cancelled request, or approved cancellation → green.
 * Pending / other → null (caller keeps default tones).
 */
export function leaveLifecycleVisual(
  status: string,
  endDate: string | null | undefined,
  dayDate?: string,
  kind?: string | null,
): "active" | "done" | null {
  const today = dayDate ?? todayIsoJerusalem();
  const end = dayOnly(endDate ?? null);
  if (status === "cancelled") return "done";
  // בקשת ביטול שאושרה = החופשה בוטלה (לא חופשה פעילה)
  if (status === "approved" && kind === "cancellation") return "done";
  if (status === "approved") {
    if (end && end < today) return "done";
    return "active";
  }
  return null;
}

export const LEAVE_LIFECYCLE_ROW: Record<"active" | "done", string> = {
  active: "border-red-300 bg-red-50/80",
  done: "border-emerald-300 bg-emerald-50/80",
};

export const LEAVE_LIFECYCLE_BADGE: Record<"active" | "done", string> = {
  active: "bg-red-100 text-red-900 border-red-200",
  done: "bg-emerald-100 text-emerald-900 border-emerald-200",
};

export function formatLeaveDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const s = dayOnly(start ?? null);
  const e = dayOnly(end ?? null);
  if (!s && !e) return null;
  if (s && e) return `${formatLeaveDay(s)} – ${formatLeaveDay(e)}`;
  return formatLeaveDay(s ?? e);
}
