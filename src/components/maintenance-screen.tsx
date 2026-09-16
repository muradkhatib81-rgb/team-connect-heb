import { useNavigate } from "@tanstack/react-router";
import { Wrench, LogOut, KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { supabase } from "@/integrations/supabase/client";
import { clearIdleSessionState } from "@/lib/use-idle-logout";
import { useAuth } from "@/lib/use-auth";

/** Hard gate while maintenance mode is on (authenticated non-owners and public routes). */
export function MaintenanceScreen({
  onOwnerSignIn,
}: {
  onOwnerSignIn?: () => void;
} = {}) {
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
      <div className="absolute top-4 end-4">
        <LanguageSwitcher />
      </div>
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
        {onOwnerSignIn ? (
          <Button variant="outline" className="w-full gap-2" onClick={onOwnerSignIn}>
            <KeyRound className="size-4" />
            {t("maintenancePage.ownerSignIn")}
          </Button>
        ) : null}
        {profile ? (
          <Button variant="outline" className="w-full gap-2" onClick={() => void signOut()}>
            <LogOut className="size-4" />
            {t("common.logout")}
          </Button>
        ) : null}
      </Card>
    </div>
  );
}
