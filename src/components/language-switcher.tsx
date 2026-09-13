import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSavedLanguagePreference,
  resolveLanguage,
  saveLanguagePreference,
  type LanguagePreference,
} from "@/i18n";
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
import { Languages, Monitor } from "lucide-react";

const LANGUAGES: {
  code: LanguagePreference;
  labelKey: string;
  icon?: typeof Monitor;
}[] = [
  { code: "system", labelKey: "contentTranslation.lang.system", icon: Monitor },
  { code: "he", labelKey: "contentTranslation.lang.he" },
  { code: "ar", labelKey: "contentTranslation.lang.ar" },
  { code: "en", labelKey: "contentTranslation.lang.en" },
];

interface LanguageSwitcherProps {
  userId?: string;
}

export function LanguageSwitcher({ userId }: LanguageSwitcherProps = {}) {
  const { i18n, t } = useTranslation();
  const qc = useQueryClient();
  const syncLangFn = useServerFn(syncPreferredLanguage);
  const preference = getSavedLanguagePreference(userId);

  function handleChange(code: LanguagePreference) {
    const resolved = resolveLanguage(code);
    void i18n.changeLanguage(resolved);
    saveLanguagePreference(code, userId);
    saveLanguagePreference(code);
    document.documentElement.dir = resolved === "en" ? "ltr" : "rtl";
    document.documentElement.lang = htmlLangAttribute(resolved);
    document.body.lang = htmlLangAttribute(resolved);
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
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[130px]">
        {LANGUAGES.map((lang) => {
          const Icon = lang.icon;
          return (
            <DropdownMenuItem
              key={lang.code}
              onClick={() => handleChange(lang.code)}
              className={preference === lang.code ? "font-semibold bg-muted" : ""}
            >
              {Icon ? <Icon className="size-3.5 me-2" /> : null}
              {t(lang.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
