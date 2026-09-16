import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Lock, Mail } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { usePlatformClientGates } from "@/lib/use-platform-feature-flags";
import { APP_NAME } from "@/lib/constants";
import i18n from "@/i18n";

export const Route = createFileRoute("/company-signup")({
  ssr: false,
  head: () => ({ meta: [{ title: `${i18n.t("companySignupPage.title")} | ${APP_NAME}` }] }),
  component: CompanySignupPage,
});

function CompanySignupPage() {
  const { t } = useTranslation();
  const gates = usePlatformClientGates();
  const locked = gates.data?.selfServeCompanySignup !== true;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-muted/30 p-4">
      <div className="absolute top-4 end-4">
        <LanguageSwitcher />
      </div>
      <Card className="w-full max-w-md p-8 text-center space-y-5 shadow-lg">
        <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
          {locked ? <Lock className="size-8" /> : <Mail className="size-8" />}
        </div>
        <div className="space-y-2">
          <h1 className="text-xl font-semibold flex items-center justify-center gap-2">
            <Building2 className="size-5" />
            {t("companySignupPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {locked ? t("companySignupPage.locked") : t("companySignupPage.unlocked")}
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link to="/auth">{t("companySignupPage.backToSignIn")}</Link>
        </Button>
      </Card>
    </div>
  );
}
