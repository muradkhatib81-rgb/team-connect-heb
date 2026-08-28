/** Display + placeholder helpers for ops error type localized names. */

export type OpsErrorTypeLocale = "he" | "ar" | "en";

/** Stored in `name_he` when Hebrew was not provided but another locale was. */
export const OPS_ERROR_TYPE_NAME_HE_PLACEHOLDER = "—";

export function localeKeyFromLanguage(lang: string): OpsErrorTypeLocale {
  if (lang.startsWith("ar")) return "ar";
  if (lang.startsWith("en")) return "en";
  return "he";
}

function pickName(...candidates: (string | null | undefined)[]): string {
  for (const value of candidates) {
    const trimmed = value?.trim();
    if (trimmed && trimmed !== OPS_ERROR_TYPE_NAME_HE_PLACEHOLDER) return trimmed;
  }
  return "—";
}

export function opsErrorTypeLabel(
  row: { name_he: string; name_ar: string | null; name_en: string | null },
  lang: string,
): string {
  const locale = localeKeyFromLanguage(lang);
  if (locale === "ar") return pickName(row.name_ar, row.name_en, row.name_he);
  if (locale === "en") return pickName(row.name_en, row.name_ar, row.name_he);
  return pickName(row.name_he, row.name_ar, row.name_en);
}

export function opsErrorTypeNamesFromRow(row: {
  name_he: string;
  name_ar: string | null;
  name_en: string | null;
}): Record<OpsErrorTypeLocale, string> {
  const he =
    row.name_he.trim() === OPS_ERROR_TYPE_NAME_HE_PLACEHOLDER ? "" : row.name_he.trim();
  return {
    he,
    ar: row.name_ar?.trim() ?? "",
    en: row.name_en?.trim() ?? "",
  };
}

export function opsErrorTypePayloadFromNames(
  names: Record<OpsErrorTypeLocale, string>,
  id?: string,
) {
  const he = names.he.trim();
  const ar = names.ar.trim();
  const en = names.en.trim();
  if (!he && !ar && !en) {
    throw new Error("Name required");
  }
  return {
    ...(id ? { id } : {}),
    name_he: he || OPS_ERROR_TYPE_NAME_HE_PLACEHOLDER,
    name_ar: ar || null,
    name_en: en || null,
  };
}
