import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useRouterState } from "@tanstack/react-router";
import { Megaphone, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/image-lightbox";
import { listVisiblePlatformAnnouncements } from "@/lib/platform-announcements.functions";
import {
  isPlatformAnnouncementsAdminPath,
  undismissedAnnouncements,
} from "@/lib/platform-announcements";
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hideOnAdmin = isPlatformAnnouncementsAdminPath(pathname);
  const listFn = useServerFn(listVisiblePlatformAnnouncements);
  const [dismissed, setDismissed] = useState<string[]>(() => readDismissed());
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ["platform-announcements-visible"],
    enabled: !!profile?.id && flags.announcements && !hideOnAdmin,
    queryFn: () => listFn(),
    staleTime: 5_000,
  });

  const items = useMemo(
    () => undismissedAnnouncements(query.data, dismissed),
    [query.data, dismissed],
  );

  const lightboxItem = items.find((row) => row.id === lightboxId && row.image_url) ?? null;

  function dismiss(id: string) {
    const next = [...dismissed, id];
    setDismissed(next);
    writeDismissed(next);
    if (lightboxId === id) setLightboxId(null);
  }

  if (hideOnAdmin || !flags.announcements || items.length === 0) return null;

  return (
    <div className="mb-4 space-y-3">
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-xl border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100"
        >
          <div className="flex items-start gap-3">
            <Megaphone className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1">
              <p className="font-medium break-words">{item.title}</p>
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{item.body}</p>
              {item.image_url && (
                <button
                  type="button"
                  className="mt-2 block overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setLightboxId(item.id)}
                  aria-label={t("platformAnnouncements.viewImage")}
                >
                  <img
                    src={item.image_url}
                    alt={t("platformAnnouncements.imageAlt")}
                    className="max-h-48 w-full rounded-md object-contain bg-black/5 dark:bg-white/5"
                  />
                </button>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0"
              onClick={() => dismiss(item.id)}
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      ))}
      {lightboxItem?.image_url && (
        <ImageLightbox
          images={[{ url: lightboxItem.image_url, alt: t("platformAnnouncements.imageAlt") }]}
          initialIndex={0}
          onClose={() => setLightboxId(null)}
        />
      )}
    </div>
  );
}
