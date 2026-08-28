import { useTranslation } from "react-i18next";
import { useServerFn } from "@tanstack/react-start";
import { saveLanguage, type AppLanguage } from "@/i18n";
import { htmlLangAttribute } from "@/lib/app-locale";
import { syncPreferredLanguage } from "@/lib/translate-content.functions";
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
  const syncLangFn = useServerFn(syncPreferredLanguage);
  const current = LANGUAGES.find((l) => l.code === i18n.language) ?? LANGUAGES[0]!;

  function handleChange(code: AppLanguage) {
    i18n.changeLanguage(code);
    saveLanguage(code, userId);
    saveLanguage(code);
    document.documentElement.dir = code === "en" ? "ltr" : "rtl";
    document.documentElement.lang = htmlLangAttribute(code);
    if (userId) {
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
            className={i18n.language === lang.code ? "font-semibold bg-muted" : ""}
          >
            {t(lang.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
