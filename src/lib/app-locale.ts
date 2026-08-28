import type { AppLanguage } from "@/i18n";

/** BCP-47 tag for `html[lang]` — Arabic UI text with Latin (0–9) digits. */
export function htmlLangAttribute(lang: AppLanguage | string): string {
  const code = lang.split("-")[0];
  if (code === "ar") return "ar-u-nu-latn";
  if (code === "en") return "en";
  return "he";
}

/** Intl locale for dates/numbers — Latin digits even when UI language is Arabic. */
export function intlLocaleForApp(lang?: string): string {
  const code = (lang ?? "he").split("-")[0];
  if (code === "ar") return "ar-u-nu-latn";
  if (code === "en") return "en-US";
  return "he-IL";
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
