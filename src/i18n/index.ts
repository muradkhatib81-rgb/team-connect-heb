import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./he.json";
import ar from "./ar.json";
import en from "./en.json";
import { resolveAppLanguageFromTags } from "@/lib/pwa-manifest";

export type AppLanguage = "he" | "ar" | "en";

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

export function getSavedLanguage(userId?: string): AppLanguage {
  try {
    // Prefer user-specific key, fall back to legacy global key
    const saved =
      parseLang(localStorage.getItem(userKey(userId))) ??
      parseLang(localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // SSR or localStorage not available
  }
  return detectSystemLanguage();
}

/** Language chosen on the login screen (no account yet). Null if they never picked one. */
export function getGuestLanguage(): AppLanguage | null {
  try {
    return parseLang(localStorage.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

export function saveLanguage(lang: AppLanguage, userId?: string) {
  try {
    localStorage.setItem(userKey(userId), lang);
  } catch {
    // SSR or localStorage not available
  }
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
