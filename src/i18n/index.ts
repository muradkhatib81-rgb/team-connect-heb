import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./he.json";
import ar from "./ar.json";
import en from "./en.json";
import { resolveAppLanguageFromTags } from "@/lib/pwa-manifest";

export type AppLanguage = "he" | "ar" | "en";
export type LanguagePreference = AppLanguage | "system";

const STORAGE_KEY = "app_language";

function userKey(userId?: string) {
  return userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
}

/** Device/OS language → he | ar | en (defaults to Hebrew). */
export function detectSystemLanguage(): AppLanguage {
  if (typeof navigator === "undefined") return "he";
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
 * Missing key → "system". Legacy keys that only store he/ar/en stay explicit prefs.
 */
export function getSavedLanguagePreference(userId?: string): LanguagePreference {
  try {
    const saved =
      parseLanguagePreference(localStorage.getItem(userKey(userId))) ??
      parseLanguagePreference(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // SSR or localStorage not available
  }
  return "system";
}

/** Concrete language for i18n init / display. */
export function getSavedLanguage(userId?: string): AppLanguage {
  return resolveLanguage(getSavedLanguagePreference(userId));
}

/** Guest preference including "system"; null if never set. */
export function getGuestLanguagePreference(): LanguagePreference | null {
  try {
    return parseLanguagePreference(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
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

i18n.use(initReactI18next).init({
  resources: {
    he: { translation: he },
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: getSavedLanguage(),
  fallbackLng: "he",
  interpolation: { escapeValue: false },
});

export default i18n;
