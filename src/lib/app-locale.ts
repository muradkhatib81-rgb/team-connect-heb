import type { AppLanguage } from "@/i18n";

const TZ = "Asia/Jerusalem";

/** Intl options that always render 0–9 digits regardless of UI language. */
export const WESTERN_DIGITS_DATE: Intl.DateTimeFormatOptions = {
  numberingSystem: "latn",
  calendar: "gregory",
};

export const WESTERN_DIGITS_NUMBER: Intl.NumberFormatOptions = {
  numberingSystem: "latn",
};

/** BCP-47 tag for `html[lang]` — Latin (0–9) digits for every UI language. */
export function htmlLangAttribute(lang: AppLanguage | string): string {
  const code = lang.split("-")[0];
  if (code === "ar") return "ar-u-nu-latn";
  if (code === "en") return "en";
  return "he-u-nu-latn";
}

/** Intl locale for dates/numbers — Latin digits even when UI language is Arabic. */
export function intlLocaleForApp(lang?: string): string {
  const code = (lang ?? "he").split("-")[0];
  if (code === "ar") return "ar-u-nu-latn";
  if (code === "en") return "en-US";
  return "he-u-nu-latn";
}

const EASTERN_ARABIC_ZERO = 0x0660;
const PERSIAN_ZERO = 0x06f0;

/** Map Eastern Arabic / Persian digits to ASCII 0–9. */
export function toWesternDigits(value: string): string {
  return value.replace(/[\u0660-\u0669\u06f0-\u06f9]/g, (ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x0660 && code <= 0x0669) return String(code - EASTERN_ARABIC_ZERO);
    return String(code - PERSIAN_ZERO);
  });
}

export function isNumericLikeInput(el: HTMLInputElement): boolean {
  const type = el.type;
  if (type === "number" || type === "tel") return true;
  const mode = el.inputMode;
  if (mode === "numeric" || mode === "decimal") return true;
  const pattern = el.getAttribute("pattern");
  return !!pattern && /\\d|\[0-9\]|\d/.test(pattern);
}

/** Normalize typed/pasted Eastern Arabic digits inside a field. */
export function normalizeWesternDigitsInField(el: HTMLInputElement | HTMLTextAreaElement): void {
  const normalized = toWesternDigits(el.value);
  if (normalized === el.value) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  el.value = normalized;
  if (start != null && end != null) {
    try {
      el.setSelectionRange(start, end);
    } catch {
      /* read-only or unsupported input types */
    }
  }
}

/** Force Western digits in every input/textarea (login + in-app). */
export function installWesternDigitsEnforcer(): () => void {
  const onInput = (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      normalizeWesternDigitsInField(target);
    }
  };
  const onPaste = (e: Event) => {
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      requestAnimationFrame(() => normalizeWesternDigitsInField(target));
    }
  };
  document.addEventListener("input", onInput, true);
  document.addEventListener("paste", onPaste, true);
  return () => {
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("paste", onPaste, true);
  };
}

export function formatAppDateTime(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  lang?: string,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(intlLocaleForApp(lang), {
    timeZone: TZ,
    ...WESTERN_DIGITS_DATE,
    ...options,
  }).format(d);
}

export function formatAppNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  lang?: string,
): string {
  return new Intl.NumberFormat(intlLocaleForApp(lang), {
    ...WESTERN_DIGITS_NUMBER,
    ...options,
  }).format(value);
}
