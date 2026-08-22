/** Branch schedule period: weekly (configurable DOW range) or monthly (1st–end). */

import type { ScheduleType } from "@/lib/use-company-settings";

/** 0=Saturday … 6=Friday (matches schedules grid / i18n dayFull). */
export type ScheduleDow = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type BranchPeriodConfig = {
  schedule_type: ScheduleType;
  week_start_dow: ScheduleDow;
  week_end_dow: ScheduleDow;
  monthly_working_dows: ScheduleDow[];
};

export const DEFAULT_MONTHLY_WORKING_DOWS: ScheduleDow[] = [0, 1, 2, 3, 4, 5, 6];

export const DEFAULT_PERIOD_CONFIG: BranchPeriodConfig = {
  schedule_type: "weekly",
  week_start_dow: 0,
  week_end_dow: 6,
  monthly_working_dows: DEFAULT_MONTHLY_WORKING_DOWS,
};

export function normalizeMonthlyWorkingDows(raw: number[] | null | undefined): ScheduleDow[] {
  const parsed = (raw ?? DEFAULT_MONTHLY_WORKING_DOWS).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6,
  ) as ScheduleDow[];
  const unique = [...new Set(parsed)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_MONTHLY_WORKING_DOWS];
}

export function branchPeriodConfigFromSettings(row: {
  schedule_type?: string | null;
  week_start_dow?: number | null;
  week_end_dow?: number | null;
  monthly_working_dows?: number[] | null;
} | null | undefined): BranchPeriodConfig {
  return {
    schedule_type: (row?.schedule_type as ScheduleType) ?? "weekly",
    week_start_dow: (typeof row?.week_start_dow === "number" ? row.week_start_dow : 0) as ScheduleDow,
    week_end_dow: (typeof row?.week_end_dow === "number" ? row.week_end_dow : 6) as ScheduleDow,
    monthly_working_dows: normalizeMonthlyWorkingDows(row?.monthly_working_dows ?? null),
  };
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** UTC calendar day → 0=Saturday … 6=Friday. */
export function utcDowFromSaturday(iso: string): ScheduleDow {
  const dow = new Date(iso + "T00:00:00Z").getUTCDay();
  return ((dow + 1) % 7) as ScheduleDow;
}

export function buildWeeklyPeriodDays(
  periodStartIso: string,
  startDow: ScheduleDow,
  endDow: ScheduleDow,
): string[] {
  const days: string[] = [];
  let iso = getWeeklyPeriodStart(periodStartIso, startDow);
  let dow = startDow;
  for (let guard = 0; guard < 8; guard++) {
    days.push(iso);
    if (dow === endDow) break;
    iso = addDaysISO(iso, 1);
    dow = ((dow + 1) % 7) as ScheduleDow;
  }
  return days;
}

export function periodDayCount(startDow: ScheduleDow, endDow: ScheduleDow): number {
  return getConfiguredWeekDows(startDow, endDow).length;
}

/** Days of week included in a weekly schedule period (e.g. Sun–Fri → [1,2,3,4,5,6]). */
export function getConfiguredWeekDows(startDow: ScheduleDow, endDow: ScheduleDow): ScheduleDow[] {
  const days: ScheduleDow[] = [];
  let dow = startDow;
  for (let guard = 0; guard < 8; guard++) {
    days.push(dow);
    if (dow === endDow) break;
    dow = ((dow + 1) % 7) as ScheduleDow;
  }
  return days;
}

export function getShiftHoursDows(
  config: Pick<BranchPeriodConfig, "schedule_type" | "week_start_dow" | "week_end_dow" | "monthly_working_dows">,
): ScheduleDow[] {
  if (config.schedule_type === "monthly") {
    return normalizeMonthlyWorkingDows(config.monthly_working_dows);
  }
  return getConfiguredWeekDows(config.week_start_dow, config.week_end_dow);
}

export function isWorkingDayInPeriod(iso: string, config: BranchPeriodConfig): boolean {
  if (config.schedule_type !== "monthly") return true;
  return normalizeMonthlyWorkingDows(config.monthly_working_dows).includes(utcDowFromSaturday(iso));
}

export function filterPeriodCalendarDays(days: string[], config: BranchPeriodConfig): string[] {
  if (config.schedule_type !== "monthly") return days;
  const allowed = new Set(normalizeMonthlyWorkingDows(config.monthly_working_dows));
  return days.filter((iso) => allowed.has(utcDowFromSaturday(iso)));
}

export function getWeeklyPeriodStart(iso: string, startDow: ScheduleDow): string {
  const refDow = utcDowFromSaturday(iso);
  const delta = refDow >= startDow ? refDow - startDow : 7 - startDow + refDow;
  return addDaysISO(iso, -delta);
}

export function getMonthlyPeriodStart(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export function getMonthlyPeriodEnd(periodStartIso: string): string {
  const d = new Date(periodStartIso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
}

export function buildMonthlyPeriodDays(
  periodStartIso: string,
  workingDows: ScheduleDow[] = DEFAULT_MONTHLY_WORKING_DOWS,
): string[] {
  const end = getMonthlyPeriodEnd(periodStartIso);
  const days: string[] = [];
  let iso = periodStartIso;
  const allowed = new Set(normalizeMonthlyWorkingDows(workingDows));
  while (iso <= end) {
    if (allowed.has(utcDowFromSaturday(iso))) days.push(iso);
    iso = addDaysISO(iso, 1);
  }
  return days;
}

export function getPeriodStart(iso: string, config: Pick<BranchPeriodConfig, "schedule_type" | "week_start_dow">): string {
  if (config.schedule_type === "monthly") return getMonthlyPeriodStart(iso);
  return getWeeklyPeriodStart(iso, config.week_start_dow);
}

export function buildPeriodDays(
  periodStartIso: string,
  config: BranchPeriodConfig,
): string[] {
  if (config.schedule_type === "monthly") {
    return buildMonthlyPeriodDays(periodStartIso, config.monthly_working_dows);
  }
  return buildWeeklyPeriodDays(periodStartIso, config.week_start_dow, config.week_end_dow);
}

export function getPeriodEnd(periodStartIso: string, config: BranchPeriodConfig): string {
  if (config.schedule_type === "monthly") {
    return getMonthlyPeriodEnd(periodStartIso);
  }
  const days = buildPeriodDays(periodStartIso, config);
  return days[days.length - 1] ?? periodStartIso;
}

export function getSchedulePeriod(reference = new Date(), config: BranchPeriodConfig = DEFAULT_PERIOD_CONFIG) {
  const refIso = new Date(
    Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()),
  )
    .toISOString()
    .slice(0, 10);
  const periodStart = getPeriodStart(refIso, config);
  const periodDays = buildPeriodDays(periodStart, config);
  return {
    periodStart,
    periodEnd: periodDays[periodDays.length - 1] ?? periodStart,
    periodDays,
  };
}

export function getCurrentPeriodStart(
  config: BranchPeriodConfig,
  reference = new Date(),
): string {
  const refIso = new Date(
    Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()),
  )
    .toISOString()
    .slice(0, 10);
  return getReferencePeriodStart(refIso, config);
}

/** Period to show when viewing schedules (handles gap days + Sun–Fri vs Sat). */
export function getReferencePeriodStart(
  refIso: string,
  config: BranchPeriodConfig,
): string {
  if (config.schedule_type === "monthly") return getPeriodStart(refIso, config);

  let start = getPeriodStart(refIso, config);
  let days = buildPeriodDays(start, config);
  let end = days[days.length - 1] ?? start;

  while (refIso > end) {
    start = shiftPeriodStart(start, config, 1);
    days = buildPeriodDays(start, config);
    end = days[days.length - 1] ?? start;
  }

  const refDow = utcDowFromSaturday(refIso);
  const allowed = new Set(getConfiguredWeekDows(config.week_start_dow, config.week_end_dow));
  if (!allowed.has(refDow) && refIso > end) {
    start = shiftPeriodStart(start, config, 1);
  }

  return start;
}

export function shiftPeriodStart(
  periodStartIso: string,
  config: BranchPeriodConfig,
  direction: -1 | 1,
): string {
  if (config.schedule_type === "monthly") {
    const d = new Date(periodStartIso + "T00:00:00Z");
    d.setUTCMonth(d.getUTCMonth() + direction, 1);
    return d.toISOString().slice(0, 10);
  }
  // Always step full calendar weeks so the next period lands on week_start_dow
  // (e.g. Sun–Fri spans 6 working days but the next period starts 7 days later).
  const normalized = getPeriodStart(periodStartIso, config);
  return addDaysISO(normalized, direction * 7);
}
