export type AiReplyLanguage = "ar" | "he" | "en";

export function normalizeAiLocale(locale?: string | null): AiReplyLanguage {
  if (locale === "ar" || locale === "en") return locale;
  return "he";
}

/** Infer reply language from message script; UI locale is fallback only. */
export function detectMessageLanguage(
  text: string,
  fallback: AiReplyLanguage,
): AiReplyLanguage {
  const sample = text.trim();
  if (!sample) return fallback;

  let arabic = 0;
  let hebrew = 0;
  let latin = 0;

  for (const char of sample) {
    const code = char.codePointAt(0)!;
    if (code >= 0x0600 && code <= 0x06ff) arabic++;
    else if (code >= 0x0590 && code <= 0x05ff) hebrew++;
    else if (/[a-zA-Z]/.test(char)) latin++;
  }

  if (arabic > hebrew && arabic >= latin) return "ar";
  if (hebrew > arabic && hebrew >= latin) return "he";
  if (latin > 0) return "en";
  return fallback;
}

export function aiLanguageLabel(lang: AiReplyLanguage): string {
  if (lang === "ar") return "Arabic";
  if (lang === "en") return "English";
  return "Hebrew";
}
