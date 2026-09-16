import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { listVisiblePlatformAnnouncements } from "@/lib/platform-announcements.functions";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";
import { useAuth } from "@/lib/use-auth";

const DISMISS_KEY = "platform-announcements-dismissed";

function readDismissed(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(DISMISS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(0, 50)));
}

export function PlatformAnnouncementsBanner() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const flags = usePlatformFeatureFlagState();
  const listFn = useServerFn(listVisiblePlatformAnnouncements);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());

  const query = useQuery({
    queryKey: ["platform-announcements-visible"],
    enabled: !!profile?.id && flags.announcements,
    queryFn: () => listFn(),
    staleTime: 5_000,
  });

  const items = useMemo(
    () => (query.data ?? []).filter((row) => !dismissed.includes(row.id)),
    [query.data, dismissed],
  );

  if (!flags.announcements || items.length === 0) return null;

  const current = items[0];

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(next);
  }

  return (
    <div className="mb-4 rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100">
      <div className="flex items-start gap-3">
        <Megaphone className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium break-words">{current.title}</p>
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{current.body}</p>
          {items.length > 1 && (
            <p className="text-xs opacity-80">
              {t("platformAnnouncements.moreCount", { count: items.length - 1 })}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0"
          onClick={() => dismiss(current.id)}
          aria-label={t("common.close")}
        >
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
