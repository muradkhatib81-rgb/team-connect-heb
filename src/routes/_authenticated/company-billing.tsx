import { createFileRoute, Link, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/use-auth";
import { useActiveBranch } from "@/lib/use-active-branch";
import { isPlatformOwner } from "@/lib/constants";
import { getCustomerBillingSnapshot } from "@/lib/billing.functions";
import { useCustomerPaymentNavVisible } from "@/lib/use-customer-billing-gate";
import type { BillingPlan } from "@/core/managers/billing-manager";
import i18n from "@/i18n";

export const Route = createFileRoute("/_authenticated/company-billing")({
  ssr: false,
  head: () => ({ meta: [{ title: i18n.t("companyBillingPage.pageTitle") }] }),
  component: CompanyBillingPage,
});

function CompanyBillingPage() {
  const { t } = useTranslation();
  const { data: profile, isLoading: profileLoading } = useAuth();
  const { activeBranchId } = useActiveBranch();
  const snapshotFn = useServerFn(getCustomerBillingSnapshot);
  const navVisible = useCustomerPaymentNavVisible();
  const owner = isPlatformOwner(profile?.roles ?? []);

  const snapshotQ = useQuery({
    queryKey: ["customer-billing-snapshot", activeBranchId ?? profile?.branch_id ?? null],
    enabled: !!profile?.id && !owner,
    queryFn: () =>
      snapshotFn({
        data: { branchId: activeBranchId ?? profile?.branch_id ?? undefined },
      }),
  });

  if (profileLoading || !profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (owner) {
    return <Navigate to="/platform/billing" replace />;
  }

  if (snapshotQ.isLoading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  const snapshot = snapshotQ.data;
  if (!snapshot?.visible || !navVisible) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
        <div className="size-12 rounded-xl bg-muted flex items-center justify-center">
          <CreditCard className="size-6 text-muted-foreground" />
        </div>
        <h1 className="text-xl font-bold">{t("companyBillingPage.hiddenTitle")}</h1>
        <p className="text-sm text-muted-foreground max-w-md">
          {t("companyBillingPage.hiddenDesc")}
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/dashboard">{t("companyBillingPage.backToDashboard")}</Link>
        </Button>
      </div>
    );
  }

  const plan = (snapshot.plan ?? "free") as BillingPlan;
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CreditCard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">{t("companyBillingPage.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("companyBillingPage.subtitle")}</p>
        </div>
      </header>

      <Card className="card-elevated p-6 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{t("companyBillingPage.currentPlan")}</span>
          <Badge variant="outline">{t(`platformBilling.plans.${plan}`)}</Badge>
          <Badge variant="secondary">
            {t(`platformBilling.status.${snapshot.status ?? "none"}`, {
              defaultValue: snapshot.status ?? "",
            })}
          </Badge>
        </div>
        {snapshot.isTrialActive && snapshot.trialEndsAt && (
          <p className="text-sm text-muted-foreground">
            {t("companyBillingPage.trialActive")}
          </p>
        )}
        <p className="text-sm text-muted-foreground">{t("companyBillingPage.comingSoon")}</p>
      </Card>
    </div>
  );
}
