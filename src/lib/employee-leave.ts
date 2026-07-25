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

export function formatLeaveDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const s = dayOnly(start ?? null);
  const e = dayOnly(end ?? null);
  if (!s && !e) return null;
  if (s && e) return `${s} – ${e}`;
  return s ?? e;
}
