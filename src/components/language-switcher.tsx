import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getSavedLanguagePreference,
  resolveLanguage,
  saveLanguagePreference,
  type AppLanguage,
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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Check, Languages, Monitor } from "lucide-react";

const PICKABLE: { code: AppLanguage; labelKey: string }[] = [
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
  const followsSystem = preference === "system";

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
        <Button
          variant="ghost"
          size="sm"
          className="px-2 h-8"
          aria-label={t("contentTranslation.lang.choose")}
        >
          <Languages className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[180px]">
        <DropdownMenuItem
          onClick={() => handleChange("system")}
          className={followsSystem ? "font-semibold bg-muted" : ""}
        >
          <Monitor className="size-3.5 me-2 shrink-0" />
          <span className="flex-1">{t("contentTranslation.lang.system")}</span>
          {followsSystem ? <Check className="size-3.5 ms-2 shrink-0" /> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger
            className={!followsSystem ? "font-semibold bg-muted" : ""}
          >
            <Languages className="size-3.5 me-2 shrink-0" />
            {t("contentTranslation.lang.choose")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-[140px]">
            {PICKABLE.map((lang) => {
              const selected = preference === lang.code;
              return (
                <DropdownMenuItem
                  key={lang.code}
                  onClick={() => handleChange(lang.code)}
                  className={selected ? "font-semibold bg-muted" : ""}
                >
                  <span className="flex-1">{t(lang.labelKey)}</span>
                  {selected ? <Check className="size-3.5 ms-2 shrink-0" /> : null}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
