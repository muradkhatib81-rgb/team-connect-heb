import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WifiOff, Wifi } from "lucide-react";
import { useNetworkStatus } from "@/lib/use-network-status";
import { cn } from "@/lib/utils";

/** Persistent offline banner + brief “back online” flash. */
export function NetworkStatusBanner() {
  const { t } = useTranslation();
  const { online } = useNetworkStatus();
  const [showOnlineFlash, setShowOnlineFlash] = useState(false);
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!online) {
      wasOffline.current = true;
      setShowOnlineFlash(false);
      return;
    }
    if (wasOffline.current) {
      wasOffline.current = false;
      setShowOnlineFlash(true);
      const tmr = setTimeout(() => setShowOnlineFlash(false), 2500);
      return () => clearTimeout(tmr);
    }
  }, [online]);

  if (online && !showOnlineFlash) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "fixed top-0 inset-x-0 z-[60] flex items-center justify-center gap-2 px-3 pb-1.5 pt-[calc(0.375rem+var(--app-safe-top))] text-xs font-medium shadow-sm",
        online
          ? "bg-emerald-600 text-white"
          : "bg-destructive text-destructive-foreground",
      )}
    >
      {online ? <Wifi className="size-3.5 shrink-0" /> : <WifiOff className="size-3.5 shrink-0" />}
      <span>{online ? t("network.online") : t("network.offline")}</span>
    </div>
  );
}
