import i18n from "@/i18n";
import {
  DEFAULT_PERIOD_CONFIG,
  getSchedulePeriod,
  utcDowFromSaturday,
  type BranchPeriodConfig,
} from "@/lib/schedule-period-config";

/** @deprecated Prefer getSchedulePeriod with branch config. Saturday–Friday week. */
export function getScheduleWeek(reference = new Date()) {
  const { periodStart, periodEnd, periodDays } = getSchedulePeriod(reference, DEFAULT_PERIOD_CONFIG);
  return { weekStart: periodStart, weekEnd: periodEnd, weekDays: periodDays };
}

export const SCHEDULE_DAY_NAMES = [
  "שבת",
  "ראשון",
  "שני",
  "שלישי",
  "רביעי",
  "חמישי",
  "שישי",
] as const;

export function getScheduleDayNames(): string[] {
  return [
    i18n.t("schedules.dayFull.0"),
    i18n.t("schedules.dayFull.1"),
    i18n.t("schedules.dayFull.2"),
    i18n.t("schedules.dayFull.3"),
    i18n.t("schedules.dayFull.4"),
    i18n.t("schedules.dayFull.5"),
    i18n.t("schedules.dayFull.6"),
  ];
}

export type ScheduleShiftCode = "morning" | "evening" | "off";

export function formatScheduleDayHe(iso: string) {
  const lang = i18n.language?.split("-")[0];
  const locale = lang === "ar" ? "ar" : lang === "en" ? "en" : "he-IL";
  return new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(new Date(iso + "T00:00:00Z"));
}

/** Day name for a calendar date (0=Sat … 6=Fri), not column index. */
export function scheduleDayLabelForDate(iso: string, variant: "short" | "full" = "short"): string {
  const dow = utcDowFromSaturday(iso);
  const key = variant === "short" ? "schedules.dayShort" : "schedules.dayFull";
  return i18n.t(`${key}.${dow}`);
}

export { getSchedulePeriod, type BranchPeriodConfig };
