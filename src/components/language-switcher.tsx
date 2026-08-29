import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { saveLanguage, type AppLanguage } from "@/i18n";
import { htmlLangAttribute } from "@/lib/app-locale";
import { syncPreferredLanguage } from "@/lib/translate-content.functions";
import type { AuthProfile } from "@/lib/use-auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Languages } from "lucide-react";

const LANGUAGES: { code: AppLanguage; labelKey: string; flag: string }[] = [
  { code: "he", labelKey: "contentTranslation.lang.he", flag: "🇮🇱" },
  { code: "ar", labelKey: "contentTranslation.lang.ar", flag: "🇸🇦" },
  { code: "en", labelKey: "contentTranslation.lang.en", flag: "🇬🇧" },
];

interface LanguageSwitcherProps {
  userId?: string;
}

export function LanguageSwitcher({ userId }: LanguageSwitcherProps = {}) {
  const { i18n, t } = useTranslation();
  const qc = useQueryClient();
  const syncLangFn = useServerFn(syncPreferredLanguage);
  const currentLang = (i18n.language ?? "he").split("-")[0];
  const current = LANGUAGES.find((l) => l.code === currentLang) ?? LANGUAGES[0]!;

  function handleChange(code: AppLanguage) {
    void i18n.changeLanguage(code);
    saveLanguage(code, userId);
    saveLanguage(code);
    document.documentElement.dir = code === "en" ? "ltr" : "rtl";
    document.documentElement.lang = htmlLangAttribute(code);
    document.body.lang = htmlLangAttribute(code);
    if (userId) {
      qc.setQueryData<AuthProfile | null>(["auth", "me"], (prev) =>
        prev ? { ...prev, preferred_language: code } : prev,
      );
      void syncLangFn({ data: { lang: code } }).catch(() => {});
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 h-8 text-xs">
          <Languages className="size-3.5" />
          <span>{t(current.labelKey)}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[130px]">
        {LANGUAGES.map((lang) => (
          <DropdownMenuItem
            key={lang.code}
            onClick={() => handleChange(lang.code)}
            className={currentLang === lang.code ? "font-semibold bg-muted" : ""}
          >
            {t(lang.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
