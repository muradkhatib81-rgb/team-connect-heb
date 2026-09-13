import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { refreshPageData } from "@/lib/refresh-page-data";
import { cn } from "@/lib/utils";

/**
 * Header refresh — refetch active queries + router loaders.
 * Must NOT call window.location.reload(): native Capacitor sets
 * persistSession:false (shared-device policy), and a full F5 drops the
 * in-memory session so beforeLoad bounces to /auth.
 */
export function HeaderRefreshButton() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshPageData(qc, router);
    } finally {
      setBusy(false);
    }
  }, [busy, qc, router]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      title={t("common.refresh")}
      aria-label={t("common.refresh")}
      disabled={busy}
      onClick={() => void onClick()}
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
    </Button>
  );
}
