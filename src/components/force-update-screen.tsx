import { useNavigate } from "@tanstack/react-router";
import { RefreshCw, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { clearIdleSessionState } from "@/lib/use-idle-logout";
import { useAuth } from "@/lib/use-auth";
import type { RunningClientInfo } from "@/lib/client-version";

/** Hard gate shown to non–Platform Owner users when the client is below min version. */
export function ForceUpdateScreen({
  client,
  minClientVersion,
}: {
  client: RunningClientInfo;
  minClientVersion: string;
}) {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    clearIdleSessionState();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  const platformLabel =
    client.platform === "android"
      ? t("forceUpdatePage.android")
      : client.platform === "ios"
        ? t("forceUpdatePage.iphone")
        : t("forceUpdatePage.windows");

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-lg">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400">
          <RefreshCw className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{t("forceUpdatePage.title")}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("forceUpdatePage.message", { platform: platformLabel })}
          </p>
          <p className="text-xs text-muted-foreground font-mono" dir="ltr">
            {t("forceUpdatePage.versions", {
              current: client.version,
              min: minClientVersion,
            })}
          </p>
        </div>
        {profile?.full_name && (
          <p className="text-sm text-muted-foreground">{profile.full_name}</p>
        )}
        <Button variant="outline" className="w-full gap-2" onClick={() => void signOut()}>
          <LogOut className="size-4" />
          {t("common.logout")}
        </Button>
      </Card>
    </div>
  );
}
