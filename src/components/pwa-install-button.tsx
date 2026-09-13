import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePwaInstall } from "@/lib/use-pwa-install";

/** Compact install control — only when Chromium offers beforeinstallprompt. */
export function PwaInstallButton() {
  const { t } = useTranslation();
  const { canInstall, promptInstall } = usePwaInstall();
  if (!canInstall) return null;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      title={t("pwa.install")}
      aria-label={t("pwa.install")}
      onClick={() => void promptInstall()}
    >
      <Download className="size-4" />
    </Button>
  );
}
