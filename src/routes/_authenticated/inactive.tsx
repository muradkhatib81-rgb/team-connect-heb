import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { LogOut, UserX } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { APP_NAME, supportContactInstruction } from "@/lib/constants";
import { useAuth } from "@/lib/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { clearIdleSessionState } from "@/lib/use-idle-logout";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_authenticated/inactive")({
  head: () => ({
    meta: [{ title: `${i18n.t("inactivePage.metaTitle")} | ${APP_NAME}` }],
  }),
  component: InactiveAccountPage,
});

function InactiveAccountPage() {
  const { t } = useTranslation();
  const { data: profile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (profile?.is_active) {
      navigate({ to: "/dashboard", replace: true });
    }
  }, [profile?.is_active, navigate]);

  async function signOut() {
    clearIdleSessionState();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-lg">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-destructive/10">
          <UserX className="size-8 text-destructive" />
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold text-destructive">{t("inactivePage.title")}</h1>
          <p className="text-sm text-destructive/90 leading-relaxed">
            {t("inactivePage.message", {
              contact: supportContactInstruction(profile?.roles ?? []),
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
