export type PwaLanguage = "he" | "ar" | "en";

export const PWA_BRANDING_BUCKET = "platform-branding";
export const PWA_ICON_PATH = "pwa-icon.png";
export const DEFAULT_PWA_ICON_192 = "/icons/icon-192.png";
export const DEFAULT_PWA_ICON_512 = "/icons/icon-512.png";

export const PWA_ICON_QUERY_KEY = ["platform-pwa-icon"] as const;

/** Install-facing copy by language (used before install; stays fixed after install). */
export const PWA_COPY: Record<
  PwaLanguage,
  { name: string; shortName: string; description: string }
> = {
  he: {
    name: "מערכת ניהול עובדים",
    shortName: "ניהול עובדים",
    description: "מערכת ניהול עובדים לניהול צוות, מחלקות, סידורים ותפקידים בסניף.",
  },
  ar: {
    name: "نظام إدارة الموظفين",
    shortName: "إدارة الموظفين",
    description: "نظام إدارة موظفين لإدارة الفريق والأقسام والجداول والمهام في الفرع.",
  },
  en: {
    name: "Employee Management System",
    shortName: "Team Connect",
    description: "Employee management for teams, departments, schedules, and branch roles.",
  },
};

/** Map Accept-Language / navigator tags → he | ar | en. */
export function resolveAppLanguageFromTags(tags: string[]): PwaLanguage {
  for (const raw of tags) {
    const tag = raw.trim().toLowerCase().split(";")[0];
    if (!tag) continue;
    if (tag.startsWith("ar")) return "ar";
    if (tag.startsWith("en")) return "en";
    if (tag.startsWith("he") || tag.startsWith("iw")) return "he";
  }
  return "he";
}

export function resolveAppLanguageFromAcceptLanguage(header: string | null | undefined): PwaLanguage {
  if (!header) return "he";
  return resolveAppLanguageFromTags(header.split(","));
}

export function buildPwaManifest(opts: {
  lang: PwaLanguage;
  iconUrl?: string | null;
}): Record<string, unknown> {
  const copy = PWA_COPY[opts.lang];
  const dir = opts.lang === "en" ? "ltr" : "rtl";
  const icon192 = opts.iconUrl || DEFAULT_PWA_ICON_192;
  const icon512 = opts.iconUrl || DEFAULT_PWA_ICON_512;
  return {
    id: "/",
    name: copy.name,
    short_name: copy.shortName,
    description: copy.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#ffffff",
    theme_color: "#0d8c8c",
    lang: opts.lang,
    dir,
    icons: [
      { src: icon192, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: icon512, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
