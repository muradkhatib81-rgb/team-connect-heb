import i18n from "@/i18n";

/** Saturday-start ISO week helpers (matches schedules.tsx). */

export function getScheduleWeek(reference = new Date()) {
  const d = new Date(
    Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()),
  );
  const dowFromSat = (d.getUTCDay() + 1) % 7;
  d.setUTCDate(d.getUTCDate() - dowFromSat);
  const weekStart = d.toISOString().slice(0, 10);
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const x = new Date(d);
    x.setUTCDate(d.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
  return { weekStart, weekEnd: weekDays[6]!, weekDays };
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
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    numberingSystem: "latn",
    calendar: "gregory",
  }).format(new Date(iso + "T00:00:00Z"));
}
