import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { CreditCard, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/use-auth";
import { isPlatformOwner } from "@/lib/constants";
import { getCustomerBillingSummary } from "@/lib/billing.functions";
import { translateBillingError } from "@/lib/billing-errors";
import {
  canShowCustomerPaymentUi,
  isCompanyPaymentOperator,
} from "@/lib/billing-visibility";
import { useCustomerPaymentVisible } from "@/lib/use-customer-payment-visible";
import i18n from "@/i18n";

export const Route = createFileRoute("/_authenticated/billing")({
  ssr: false,
  head: () => ({ meta: [{ title: i18n.t("customerBilling.title") }] }),
  component: CustomerBillingPage,
});

function CustomerBillingPage() {
  const { t } = useTranslation();
  const { data: profile, isLoading: profileLoading } = useAuth();
  const visibleQ = useCustomerPaymentVisible();
  const summaryFn = useServerFn(getCustomerBillingSummary);

  const isOwner = isPlatformOwner(profile?.roles ?? []);
  const showCustomerUi = canShowCustomerPaymentUi({
    customerPaymentVisible: visibleQ.data === true,
    isPlatformOwner: isOwner,
    isCompanyOperator: isCompanyPaymentOperator(profile?.roles ?? []),
  });

  const summaryQ = useQuery({
    queryKey: ["customer-billing-summary"],
    queryFn: () => summaryFn(),
    enabled: showCustomerUi && !isOwner,
  });

  if (profileLoading || visibleQ.isLoading || !profile) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isOwner) {
    return <Navigate to="/platform/billing" search={{ checkout: undefined }} replace />;
  }

  if (!showCustomerUi) {
    return <Navigate to="/dashboard" replace />;
  }

  const summary = summaryQ.data;
  const planLabel = summary
    ? t(`platformBilling.plans.${summary.plan}`, { defaultValue: summary.plan })
    : "—";
  const statusLabel = summary
    ? t(`platformBilling.status.${summary.status}`, { defaultValue: summary.status })
    : "—";

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CreditCard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="break-words text-2xl sm:text-3xl font-bold">{t("customerBilling.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("customerBilling.subtitle")}</p>
        </div>
      </header>

      {summaryQ.isError && (
        <Card className="p-4 text-sm text-destructive">
          {summaryQ.error instanceof Error
            ? translateBillingError(summaryQ.error.message, t)
            : t("customerBilling.unavailable")}
        </Card>
      )}

      {summaryQ.isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      )}

      {summary && !summary.companyId && (
        <Card className="card-elevated p-5 text-sm text-muted-foreground">
          {t("customerBilling.noCompany")}
        </Card>
      )}

      {summary?.companyId && (
        <Card className="card-elevated p-5 space-y-3">
          <p className="text-sm font-medium">{t("customerBilling.currentPlan")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{planLabel}</Badge>
            <span className="text-sm text-muted-foreground">{statusLabel}</span>
          </div>
          <p className="text-xs text-muted-foreground">{t("customerBilling.selfServeHint")}</p>
        </Card>
      )}
    </div>
  );
}
