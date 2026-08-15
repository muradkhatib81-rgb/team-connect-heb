import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import he from "./he.json";
import ar from "./ar.json";
import en from "./en.json";

export type AppLanguage = "he" | "ar" | "en";

const STORAGE_KEY = "app_language";

function userKey(userId?: string) {
  return userId ? `${STORAGE_KEY}_${userId}` : STORAGE_KEY;
}

export function getSavedLanguage(userId?: string): AppLanguage {
  try {
    // Prefer user-specific key, fall back to legacy global key
    const saved =
      localStorage.getItem(userKey(userId)) ?? localStorage.getItem(STORAGE_KEY);
    if (saved === "he" || saved === "ar" || saved === "en") return saved;
  } catch {
    // SSR or localStorage not available
  }
  return "he";
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
