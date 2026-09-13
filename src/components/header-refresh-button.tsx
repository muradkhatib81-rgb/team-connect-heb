import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Header refresh — full page reload (same as F5). */
export function HeaderRefreshButton() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const onClick = useCallback(() => {
    if (busy) return;
    setBusy(true);
    window.location.reload();
  }, [busy]);

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      title={t("common.refresh")}
      aria-label={t("common.refresh")}
      disabled={busy}
      onClick={onClick}
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} />
    </Button>
  );
}
