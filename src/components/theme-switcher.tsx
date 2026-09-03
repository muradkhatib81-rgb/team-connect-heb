import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Sun, Moon, Monitor } from "lucide-react";
import { syncPreferredTheme, type AppTheme } from "@/lib/translate-content.functions";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import type { AuthProfile } from "@/lib/use-auth";

const THEMES: { value: AppTheme; labelKey: string; icon: typeof Sun }[] = [
  { value: "light", labelKey: "theme.light", icon: Sun },
  { value: "dark", labelKey: "theme.dark", icon: Moon },
  { value: "system", labelKey: "theme.system", icon: Monitor },
];

function resolveTheme(theme: AppTheme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function applyTheme(theme: AppTheme) {
  const resolved = resolveTheme(theme);
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface ThemeSwitcherProps {
  userId?: string;
  currentTheme?: AppTheme;
}

export function ThemeSwitcher({ userId, currentTheme = "system" }: ThemeSwitcherProps) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const syncThemeFn = useServerFn(syncPreferredTheme);

  const current = THEMES.find((th) => th.value === currentTheme) ?? THEMES[2]!;
  const Icon = current.icon;

  function handleChange(theme: AppTheme) {
    applyTheme(theme);
    if (userId) {
      qc.setQueryData<AuthProfile | null>(["auth", "me"], (prev) =>
        prev ? { ...prev, preferred_theme: theme } : prev,
      );
      void syncThemeFn({ data: { theme } }).catch(() => {});
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2 h-8 text-xs">
          <Icon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[130px]">
        {THEMES.map((th) => {
          const ThIcon = th.icon;
          return (
            <DropdownMenuItem
              key={th.value}
              onClick={() => handleChange(th.value)}
              className={currentTheme === th.value ? "font-semibold bg-muted" : ""}
            >
              <ThIcon className="size-3.5 me-2" />
              {t(th.labelKey)}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
