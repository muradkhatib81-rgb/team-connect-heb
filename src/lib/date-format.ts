// Date/time formatting helpers locked to Asia/Jerusalem; locale follows active app language.
import i18n from "@/i18n";
import { intlLocaleForApp, WESTERN_DIGITS_DATE } from "@/lib/app-locale";

const TZ = "Asia/Jerusalem";

function intlLocale(): string {
  return intlLocaleForApp(i18n.language);
}

export function formatHeDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: TZ,
    dateStyle: "short",
    timeStyle: "short",
    ...WESTERN_DIGITS_DATE,
  }).format(d);
}

export function formatHeDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: TZ,
    dateStyle: "short",
    ...WESTERN_DIGITS_DATE,
  }).format(d);
}

/** HH:MM wall clock in Asia/Jerusalem (24h, Latin digits). */
export function formatHeTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocale(), {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    numberingSystem: "latn",
  }).format(d);
}

// Split an ISO datetime into local "YYYY-MM-DD" + "HH:MM" parts in Asia/Jerusalem.
export function splitForInputs(iso?: string | null): { date: string; time: string } {
  if (!iso) return { date: "", time: "" };
  const d = new Date(iso);
  if (isNaN(d.getTime())) return { date: "", time: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

// Combine local date+time (interpreted as Asia/Jerusalem wall clock) to a UTC ISO.
export function combineToIso(date: string, time: string): string | null {
  if (!date || !time) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  if (!y || !m || !d) return null;
  // Two-pass adjustment to compensate for tz offset.
  let utc = Date.UTC(y, m - 1, d, hh ?? 0, mm ?? 0, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Jerusalem",
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
  return new Date(utc).toISOString();
}
