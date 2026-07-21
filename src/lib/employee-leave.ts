/** Profile fields used to decide if an employee is on leave on a calendar day (YYYY-MM-DD). */
export type EmployeeLeaveFields = {
  on_leave?: boolean | null;
  leave_start_date?: string | null;
  leave_end_date?: string | null;
};

function dayOnly(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.slice(0, 10);
}

/** True when the employee should be treated as on leave (חופש) for schedule purposes on `dayDate`. */
export function isEmployeeOnLeaveOnDate(
  emp: EmployeeLeaveFields,
  dayDate: string,
): boolean {
  if (!emp.on_leave) return false;
  const start = dayOnly(emp.leave_start_date);
  const end = dayOnly(emp.leave_end_date);
  if (start && end) return dayDate >= start && dayDate <= end;
  if (start) return dayDate >= start;
  if (end) return dayDate <= end;
  // Legacy rows: on_leave without dates → treat whole schedule week as leave.
  return true;
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
