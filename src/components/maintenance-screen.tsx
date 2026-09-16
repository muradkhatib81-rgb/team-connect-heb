import { useNavigate } from "@tanstack/react-router";
import { Wrench, LogOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { clearIdleSessionState } from "@/lib/use-idle-logout";
import { useAuth } from "@/lib/use-auth";

/** Hard gate shown to non–Platform Owner users while maintenance mode is on. */
export function MaintenanceScreen() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const navigate = useNavigate();

  async function signOut() {
    clearIdleSessionState();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-lg">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
          <Wrench className="size-8" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold">{t("maintenancePage.title")}</h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("maintenancePage.message")}
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
