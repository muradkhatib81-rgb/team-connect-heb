import i18n from "@/i18n";
export const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

export function eomMonthKey(year: number, month: number): number {
  return year * 12 + month;
}

export function eomMonthsAgo(
  year: number,
  month: number,
  monthsBack: number,
): { year: number; month: number } {
  let m = month - monthsBack;
  let y = year;
  while (m <= 0) {
    m += 12;
    y -= 1;
  }
  return { year: y, month: m };
}

/** Rolling 12-month window ending at the given calendar month (inclusive). */
export function buildRolling12MonthSlots(
  reference: Date = new Date(),
): Array<{ year: number; month: number }> {
  const year = reference.getFullYear();
  const month = reference.getMonth() + 1;
  const slots: Array<{ year: number; month: number }> = [];
  for (let i = 0; i < 12; i++) {
    slots.push(eomMonthsAgo(year, month, i));
  }
  return slots;
}

export function formatEomMonthLabel(year: number, month: number): string {
  const months = i18n.t("libErrors.eom.months", { returnObjects: true }) as string[];
  const monthName = Array.isArray(months) ? months[month - 1] ?? String(month) : String(month);
  return `${monthName} ${year}`;
}
