import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import { resolveAppLanguageFromTags } from "@/lib/pwa-manifest";

export type AppLanguage = "he" | "ar" | "en";
export type LanguagePreference = AppLanguage | "system";

/** First visit / missing preference / i18n fallback. */
export const DEFAULT_APP_LANGUAGE: AppLanguage = "en";

const STORAGE_KEY = "app_language";

function userKey(userId?: string) {
  return userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
}

function readStoredPreference(key: string): LanguagePreference | null {
  try {
    return parseLanguagePreference(localStorage.getItem(key));
  } catch {
    return null;
  }
}

/** Device/OS language → he | ar | en (defaults to English). */
export function detectSystemLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return DEFAULT_APP_LANGUAGE;
  const tags = [...(navigator.languages ?? []), navigator.language].filter(Boolean) as string[];
  return resolveAppLanguageFromTags(tags);
}

function parseLang(value: string | null): AppLanguage | null {
  if (value === "he" || value === "ar" || value === "en") return value;
  return null;
}

export function parseLanguagePreference(value: string | null | undefined): LanguagePreference | null {
  if (value === "he" || value === "ar" || value === "en" || value === "system") return value;
  return null;
}

/** Resolve a preference (including "system") to a concrete UI language. */
export function resolveLanguage(pref: LanguagePreference): AppLanguage {
  if (pref === "system") return detectSystemLanguage();
  return pref;
}

/**
 * Preference mode from localStorage (he|ar|en|system).
 * Missing key → English. Legacy keys that only store he/ar/en stay explicit prefs.
 */
export function getSavedLanguagePreference(userId?: string): LanguagePreference {
  const saved =
    (userId ? readStoredPreference(userKey(userId)) : null) ??
    readStoredPreference(STORAGE_KEY);
  return saved ?? DEFAULT_APP_LANGUAGE;
}

/** True when this browser has an explicit he/ar/en/system pick. */
export function hasStoredLanguagePreference(userId?: string): boolean {
  if (userId && readStoredPreference(userKey(userId))) return true;
  return !!readStoredPreference(STORAGE_KEY);
}

/** Concrete language for i18n init / display. */
export function getSavedLanguage(userId?: string): AppLanguage {
  return resolveLanguage(getSavedLanguagePreference(userId));
}

/** Guest preference including "system"; null if never set. */
export function getGuestLanguagePreference(): LanguagePreference | null {
  return readStoredPreference(STORAGE_KEY);
}

/**
 * Language chosen on the login screen (no account yet).
 * Only returns he/ar/en when guest explicitly picked one; null for system or never picked
 * so login can fall back to the profile preference.
 */
export function getGuestLanguage(): AppLanguage | null {
  return parseLang(
    (() => {
      try {
        return localStorage.getItem(STORAGE_KEY);
      } catch {
        return null;
      }
    })(),
  );
}

/**
 * Language to apply after sign-in.
 * Explicit local / guest / profile he|ar|en wins. DB default `system` without a
 * stored pick is treated as "no preference" → English.
 */
export function resolveSignedInLanguagePreference(input: {
  userId: string;
  profilePreference: LanguagePreference | null | undefined;
}): LanguagePreference {
  const guestLang = getGuestLanguage();
  if (guestLang) return guestLang;

  const guestPref = getGuestLanguagePreference();
  if (guestPref === "system") return "system";

  const userStored = readStoredPreference(userKey(input.userId));
  if (userStored === "he" || userStored === "ar" || userStored === "en") return userStored;
  if (userStored === "system") return "system";

  const profile = parseLanguagePreference(input.profilePreference);
  if (profile === "he" || profile === "ar" || profile === "en") return profile;

  return DEFAULT_APP_LANGUAGE;
}

export function saveLanguagePreference(pref: LanguagePreference, userId?: string) {
  try {
    localStorage.setItem(userKey(userId), pref);
  } catch {
    // SSR or localStorage not available
  }
}

/** Save an explicit language preference (he|ar|en). */
export function saveLanguage(lang: AppLanguage, userId?: string) {
  saveLanguagePreference(lang, userId);
}

const localeLoaders: Record<AppLanguage, () => Promise<{ default: Record<string, unknown> }>> = {
  he: () => import("./he.json"),
  ar: () => import("./ar.json"),
  en: () => import("./en.json"),
};

const loadedLocales = new Set<AppLanguage>(["en"]);

/** Load he/ar/en on demand. English is always bundled as fallbackLng. */
export async function ensureLanguageLoaded(lang: AppLanguage): Promise<void> {
  if (loadedLocales.has(lang)) return;
  const mod = await localeLoaders[lang]();
  i18n.addResourceBundle(lang, "translation", mod.default, true, true);
  loadedLocales.add(lang);
}

const initialLng = getSavedLanguage();

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
  },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

if (initialLng !== "en") {
  void ensureLanguageLoaded(initialLng).then(() => {
    void i18n.changeLanguage(initialLng);
  });
}

export default i18n;
