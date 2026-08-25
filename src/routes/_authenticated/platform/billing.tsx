import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import { Building2, CreditCard, Clock, ExternalLink, GitBranch, HardDrive, Loader2, Sparkles, Users } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSingleSelect } from "@/components/searchable-picker";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import type { BillingPlan } from "@/core/managers/billing-manager";
import {
  createBillingCheckoutSession,
  createBillingPortalSession,
  getBillingOverview,
  saveBillingAllocation,
  setManualBillingPlan,
  startBillingTrial,
} from "@/lib/billing.functions";
import {
  DEFAULT_PLAN_ENTITLEMENTS,
  DEFAULT_TRIAL_DAYS,
  formatLimit,
  trialDaysRemaining,
} from "@/lib/billing-entitlements";
import { translateBillingError } from "@/lib/billing-errors";
import {
  DEFAULT_STORAGE_QUOTA_MB,
  formatUsedBytes,
  gbToMb,
  mbToGbInput,
  mbToGbLabel,
} from "@/lib/billing-storage";

export const Route = createFileRoute("/_authenticated/platform/billing")({
  component: PlatformBillingPage,
  validateSearch: (s: Record<string, unknown>) => ({
    checkout: s.checkout === "success" || s.checkout === "cancel" ? s.checkout : undefined,
  }),
});

const PLAN_TONES: Record<BillingPlan, string> = {
  free: "bg-muted text-muted-foreground",
  standard: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-500",
};

const COMPANY_SCOPE = "__company__";
const OVERVIEW_KEY = ["platform-billing-overview"] as const;

function dateLocale(lang: string) {
  return lang === "ar" ? "ar-SA" : lang === "en" ? "en-US" : "he-IL";
}

function PlatformBillingPage() {
  const { t, i18n } = useTranslation();
  const locale = dateLocale(i18n.language);
  const planLabel = (plan: BillingPlan) => t(`platformBilling.plans.${plan}`);
  const statusLabel = (status: string) =>
    t(`platformBilling.status.${status}`, { defaultValue: status });
  const unlimited = t("platformBilling.unlimited");
  const catalogMinutesLabel = (minutes: number | null | undefined) =>
    minutes == null ? unlimited : t("platformBilling.minutesPerMonth", { count: minutes });
  const toastBillingError = (e: Error) => toast.error(translateBillingError(e.message, t));

  const { companies, isLoading: companiesLoading, activeCompanyId } = useCompanyContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const overviewFn = useServerFn(getBillingOverview);
  const setPlanFn = useServerFn(setManualBillingPlan);
  const saveAllocFn = useServerFn(saveBillingAllocation);
  const checkoutFn = useServerFn(createBillingCheckoutSession);
  const portalFn = useServerFn(createBillingPortalSession);
  const startTrialFn = useServerFn(startBillingTrial);

  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState(COMPANY_SCOPE);
  const [draftPlan, setDraftPlan] = useState<BillingPlan>("free");
  const [draftMinutes, setDraftMinutes] = useState("");
  const [draftStorageGb, setDraftStorageGb] = useState("");
  const [draftAiEnabled, setDraftAiEnabled] = useState(true);
  const [checkoutPlan, setCheckoutPlan] = useState<"standard" | "enterprise">("standard");

  const overviewQ = useQuery({
    queryKey: OVERVIEW_KEY,
    queryFn: () => overviewFn(),
  });
  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  useEffect(() => {
    if (search.checkout === "success") {
      toast.success(t("platformBilling.checkoutSuccess"));
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      void navigate({ to: "/platform/billing", search: {}, replace: true });
    } else if (search.checkout === "cancel") {
      toast.message(t("platformBilling.checkoutCancel"));
      void navigate({ to: "/platform/billing", search: {}, replace: true });
    }
  }, [search.checkout, navigate, qc, t]);

  const companyOptions = useMemo(
    () => companies.map((c) => ({ id: c.id, label: c.name })),
    [companies],
  );
  const companyBranches = useMemo(
    () => (branchesQ.data ?? []).filter((b) => b.companyId === selectedCompanyId),
    [branchesQ.data, selectedCompanyId],
  );
  const branchOptions = useMemo(
    () => [
      { id: COMPANY_SCOPE, label: t("platformBilling.wholeCompany") },
      ...companyBranches.map((b) => ({
        id: b.id,
        label: b.name,
        sublabel: b.code ?? undefined,
      })),
    ],
    [companyBranches, t],
  );
  const byCompany = useMemo(() => {
    const map = new Map((overviewQ.data?.companies ?? []).map((c) => [c.companyId, c]));
    return map;
  }, [overviewQ.data]);
  const entitlements = overviewQ.data?.entitlements ?? [];
  const grants = overviewQ.data?.grants ?? [];
  const storageEntitlements = overviewQ.data?.storageEntitlements ?? [];
  const storageGrants = overviewQ.data?.storageGrants ?? [];
  const planEntitlements =
    overviewQ.data?.planEntitlements?.length
      ? overviewQ.data.planEntitlements
      : Object.values(DEFAULT_PLAN_ENTITLEMENTS);
  const storageCatalogMb = (plan: BillingPlan) =>
    storageEntitlements.find((e) => e.billing_plan === plan)?.storage_quota_mb ??
    DEFAULT_STORAGE_QUOTA_MB[plan];

  useEffect(() => {
    if (selectedCompanyId) return;
    const preferred =
      (activeCompanyId && companies.some((c) => c.id === activeCompanyId) ? activeCompanyId : null) ??
      companies[0]?.id ??
      "";
    if (preferred) setSelectedCompanyId(preferred);
  }, [activeCompanyId, companies, selectedCompanyId]);

  const selectedCompany = companies.find((c) => c.id === selectedCompanyId) ?? null;
  const selectedRow = selectedCompanyId ? byCompany.get(selectedCompanyId) : undefined;
  const companyPlan = selectedRow?.plan ?? "free";
  const isCompanyScope = selectedBranchId === COMPANY_SCOPE;
  const selectedGrant = useMemo(() => {
    if (!selectedCompanyId) return undefined;
    if (isCompanyScope) {
      return grants.find((g) => g.scope_type === "company" && g.scope_id === selectedCompanyId);
    }
    return grants.find((g) => g.scope_type === "branch" && g.scope_id === selectedBranchId);
  }, [grants, isCompanyScope, selectedBranchId, selectedCompanyId]);

  const selectedStorageGrant = useMemo(() => {
    if (!selectedCompanyId) return undefined;
    if (isCompanyScope) {
      return storageGrants.find((g) => g.scope_type === "company" && g.scope_id === selectedCompanyId);
    }
    return storageGrants.find((g) => g.scope_type === "branch" && g.scope_id === selectedBranchId);
  }, [isCompanyScope, selectedBranchId, selectedCompanyId, storageGrants]);

  const visibleGrants = useMemo(() => {
    if (!selectedCompanyId) return [];
    const branchIds = new Set(companyBranches.map((b) => b.id));
    return grants.filter(
      (g) =>
        (g.scope_type === "company" && g.scope_id === selectedCompanyId) ||
        (g.scope_type === "branch" && branchIds.has(g.scope_id)),
    );
  }, [companyBranches, grants, selectedCompanyId]);

  const visibleStorageGrants = useMemo(() => {
    if (!selectedCompanyId) return [];
    const branchIds = new Set(companyBranches.map((b) => b.id));
    return storageGrants.filter(
      (g) =>
        (g.scope_type === "company" && g.scope_id === selectedCompanyId) ||
        (g.scope_type === "branch" && branchIds.has(g.scope_id)),
    );
  }, [companyBranches, selectedCompanyId, storageGrants]);

  useEffect(() => {
    const plan =
      (selectedGrant?.billing_plan as BillingPlan | null) ??
      (selectedStorageGrant?.billing_plan as BillingPlan | null) ??
      companyPlan;
    const catalogMinutes = entitlements.find((e) => e.billing_plan === plan)?.monthly_minutes;
    const catalogStorage = storageCatalogMb(plan);
    setDraftPlan(plan);
    setDraftMinutes(
      selectedGrant?.quota_minutes != null
        ? String(selectedGrant.quota_minutes)
        : catalogMinutes != null
          ? String(catalogMinutes)
          : "",
    );
    setDraftStorageGb(
      selectedStorageGrant
        ? mbToGbInput(selectedStorageGrant.storage_quota_mb)
        : mbToGbInput(catalogStorage),
    );
    setDraftAiEnabled(selectedGrant?.is_active ?? true);
  }, [
    selectedCompanyId,
    selectedBranchId,
    companyPlan,
    selectedGrant?.billing_plan,
    selectedGrant?.quota_minutes,
    selectedGrant?.is_active,
    selectedStorageGrant?.billing_plan,
    selectedStorageGrant?.storage_quota_mb,
    entitlements,
    storageEntitlements,
  ]);

  const setPlanMut = useMutation({
    mutationFn: (input: { companyId: string | null; plan: BillingPlan }) =>
      setPlanFn({ data: input }),
    onSuccess: () => {
      toast.success(t("platformBilling.planSaved"));
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (e: Error) => toastBillingError(e),
  });

  const saveAllocMut = useMutation({
    mutationFn: () => {
      if (!selectedCompanyId) throw new Error(t("platformBilling.pickCompanyError"));
      const trimmed = draftMinutes.trim();
      const quotaMinutes = trimmed === "" ? null : Number(trimmed);
      if (quotaMinutes != null && !Number.isFinite(quotaMinutes)) {
        throw new Error(t("platformBilling.invalidMinutes"));
      }
      const storageTrimmed = draftStorageGb.trim();
      const storageGb = storageTrimmed === "" ? null : Number(storageTrimmed);
      if (storageGb != null && (!Number.isFinite(storageGb) || storageGb < 0)) {
        throw new Error(t("platformBilling.invalidStorage"));
      }
      return saveAllocFn({
        data: {
          companyId: selectedCompanyId,
          branchId: isCompanyScope ? null : selectedBranchId,
          plan: draftPlan,
          quotaMinutes,
          useCatalogMinutes: false,
          aiEnabled: draftAiEnabled,
          storageQuotaMb: gbToMb(storageGb),
          useCatalogStorage: false,
        },
      });
    },
    onSuccess: () => {
      toast.success(t("platformBilling.allocationSaved"));
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (e: Error) => toastBillingError(e),
  });

  const checkoutMut = useMutation({
    mutationFn: (input: { companyId: string; plan: "standard" | "enterprise" }) =>
      checkoutFn({ data: input }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toastBillingError(e),
  });

  const portalMut = useMutation({
    mutationFn: (companyId: string) => portalFn({ data: { companyId } }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toastBillingError(e),
  });

  const trialMut = useMutation({
    mutationFn: (companyId: string) =>
      startTrialFn({ data: { companyId, days: DEFAULT_TRIAL_DAYS } }),
    onSuccess: (res) => {
      toast.success(
        t("platformBilling.trialStarted", {
          date: new Date(res.trialEndsAt).toLocaleDateString(locale),
        }),
      );
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (e: Error) => toastBillingError(e),
  });

  const overview = overviewQ.data;
  const platformPlan = overview?.platform.plan ?? "free";
  const catalogForDraft = entitlements.find((e) => e.billing_plan === draftPlan);
  const storageCatalogForDraftMb = storageCatalogMb(draftPlan);
  const trialDaysLeft = trialDaysRemaining(selectedRow?.trialEndsAt);
  const canStartTrial =
    isCompanyScope &&
    !!selectedCompanyId &&
    !selectedRow?.isTrialActive &&
    companyPlan === "free" &&
    !selectedRow?.stripeSubscriptionId;
  const planLimits = planEntitlements.find((e) => e.billing_plan === companyPlan);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CreditCard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformBilling.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("platformBilling.subtitle")}</p>
        </div>
      </header>

      {overviewQ.isError && (
        <Card className="p-4 text-sm text-destructive">
          {overviewQ.error instanceof Error
            ? translateBillingError(overviewQ.error.message, t)
            : t("platformBilling.loadFailed")}
        </Card>
      )}

      {overview && !overview.stripeConfigured && (
        <Card className="p-4 text-sm text-muted-foreground">{t("platformBilling.stripeNotConfigured")}</Card>
      )}

      {overview && (overview.storageEntitlements?.length ?? 0) === 0 && (
        <Card className="p-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          {t("platformBilling.storageTablesMissing")}
        </Card>
      )}

      <Card className="card-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t("platformBilling.platformSubscription")}
        </h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={PLAN_TONES[platformPlan]}>{planLabel(platformPlan)}</Badge>
          {overview?.platform.source && (
            <span className="text-xs text-muted-foreground">
              {t("platformBilling.source", {
                source:
                  overview.platform.source === "stripe"
                    ? t("platformBilling.sourceStripe")
                    : t("platformBilling.sourceManual"),
              })}
            </span>
          )}
          <Select
            value={platformPlan}
            onValueChange={(value) =>
              setPlanMut.mutate({ companyId: null, plan: value as BillingPlan })
            }
            disabled={setPlanMut.isPending || overviewQ.isLoading}
          >
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(["free", "standard", "enterprise"] as BillingPlan[]).map((value) => (
                <SelectItem key={value} value={value}>
                  {planLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="card-elevated p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground flex items-center gap-2">
            <Building2 className="size-4" />
            {t("platformBilling.companyAllocationTitle")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            {t("platformBilling.companyAllocationHint")}
          </p>
        </div>
        {companiesLoading || overviewQ.isLoading ? (
          <div className="text-sm text-muted-foreground">{t("platformBilling.loading")}</div>
        ) : companies.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("platformBilling.noCompanies")}</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t("platformBilling.company")}</Label>
                <SearchableSingleSelect
                  options={companyOptions}
                  value={selectedCompanyId}
                  onChange={(id) => {
                    setSelectedCompanyId(id);
                    setSelectedBranchId(COMPANY_SCOPE);
                  }}
                  placeholder={t("platformBilling.pickCompany")}
                  searchPlaceholder={t("platformBilling.searchCompany")}
                  emptyText={t("platformBilling.noCompanyFound")}
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <GitBranch className="size-3.5" />
                  {t("platformBilling.branch")}
                </Label>
                <SearchableSingleSelect
                  options={branchOptions}
                  value={selectedBranchId}
                  onChange={setSelectedBranchId}
                  placeholder={t("platformBilling.pickBranch")}
                  searchPlaceholder={t("platformBilling.searchBranch")}
                  emptyText={t("platformBilling.noBranchFound")}
                  disabled={!selectedCompanyId}
                />
              </div>
            </div>

            {selectedCompany && (
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-base font-semibold">{selectedCompany.name}</p>
                  {!isCompanyScope && (
                    <Badge variant="outline">
                      {companyBranches.find((b) => b.id === selectedBranchId)?.name ??
                        t("platformBilling.branch")}
                    </Badge>
                  )}
                  <Badge className={PLAN_TONES[companyPlan]}>{planLabel(companyPlan)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("platformBilling.statusLine", {
                    status: statusLabel(selectedRow?.status ?? "none"),
                  })}
                  {selectedRow?.isTrialActive && trialDaysLeft != null
                    ? ` · ${t("platformBilling.trialDaysLeft", { count: trialDaysLeft })}`
                    : ""}
                  {selectedRow?.source
                    ? ` · ${
                        selectedRow.source === "stripe"
                          ? t("platformBilling.sourceStripe")
                          : t("platformBilling.sourceManual")
                      }`
                    : ""}
                  {selectedRow?.currentPeriodEnd
                    ? ` · ${t("platformBilling.periodUntil", {
                        date: new Date(selectedRow.currentPeriodEnd).toLocaleDateString(locale),
                      })}`
                    : ""}
                  {selectedRow?.trialEndsAt && !selectedRow.isTrialActive
                    ? ` · ${t("platformBilling.trialEndedOn", {
                        date: new Date(selectedRow.trialEndsAt).toLocaleDateString(locale),
                      })}`
                    : ""}
                  {isCompanyScope
                    ? ` · ${t("platformBilling.saveUpdatesCompanyPlan")}`
                    : ` · ${t("platformBilling.saveUpdatesBranchOnly")}`}
                </p>

                {isCompanyScope && selectedRow?.usage && planLimits && (
                  <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Users className="size-3.5" />
                      {t("platformBilling.employeesUsage", {
                        used: selectedRow.usage.employees,
                        max: planLimits.max_employees ?? "∞",
                      })}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="size-3.5" />
                      {t("platformBilling.branchesUsage", {
                        used: selectedRow.usage.branches,
                        max: planLimits.max_branches ?? "∞",
                      })}
                    </span>
                    {planLimits.realtime_enabled ? (
                      <Badge variant="secondary">{t("platformBilling.realtimeOn")}</Badge>
                    ) : (
                      <Badge variant="outline">{t("platformBilling.realtimeOff")}</Badge>
                    )}
                  </div>
                )}

                {selectedRow?.isTrialActive && (
                  <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 flex items-center gap-2">
                    <Clock className="size-4 shrink-0" />
                    {t("platformBilling.trialBanner")}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>{t("platformBilling.plan")}</Label>
                    <Select
                      value={draftPlan}
                      onValueChange={(value) => {
                        const plan = value as BillingPlan;
                        setDraftPlan(plan);
                        const minutes = entitlements.find((e) => e.billing_plan === plan)?.monthly_minutes;
                        setDraftMinutes(minutes != null ? String(minutes) : "");
                        setDraftStorageGb(mbToGbInput(storageCatalogMb(plan)));
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["free", "standard", "enterprise"] as BillingPlan[]).map((value) => (
                          <SelectItem key={value} value={value}>
                            {planLabel(value)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {t("platformBilling.catalogDefault", {
                        minutes: catalogMinutesLabel(catalogForDraft?.monthly_minutes),
                        storage: mbToGbLabel(storageCatalogForDraftMb, unlimited),
                      })}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>{t("platformBilling.aiMinutes")}</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder={t("platformBilling.minutesUnlimitedPlaceholder")}
                      value={draftMinutes}
                      onChange={(e) => setDraftMinutes(e.target.value)}
                    />
                    {selectedGrant && (
                      <p className="text-xs text-muted-foreground">
                        {t("platformBilling.minutesUsed", {
                          used: Number(selectedGrant.used_minutes ?? 0).toFixed(1),
                        })}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="flex items-center gap-1.5">
                      <HardDrive className="size-3.5" />
                      {t("platformBilling.storageGb")}
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder={t("platformBilling.minutesUnlimitedPlaceholder")}
                      value={draftStorageGb}
                      onChange={(e) => setDraftStorageGb(e.target.value)}
                      className="sm:max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("platformBilling.storageHint")}
                      {selectedStorageGrant
                        ? ` · ${t("platformBilling.storageUsed", {
                            used: formatUsedBytes(Number(selectedStorageGrant.used_bytes ?? 0)),
                          })}`
                        : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="size-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{t("platformBilling.aiAssistant")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("platformBilling.aiAssistantHint")}
                      </p>
                    </div>
                  </div>
                  <Switch checked={draftAiEnabled} onCheckedChange={setDraftAiEnabled} />
                </div>

                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <p>{t("platformBilling.stripeVsAppHint")}</p>
                  <p>{t("platformBilling.storageNextStepHint")}</p>
                  <Link to="/platform/ai" className="text-primary underline-offset-2 hover:underline">
                    {t("platformBilling.openAiAdmin")}
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => saveAllocMut.mutate()} disabled={saveAllocMut.isPending}>
                    {saveAllocMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("platformBilling.saveAllocation")}
                  </Button>
                  {canStartTrial && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={trialMut.isPending}
                      onClick={() => trialMut.mutate(selectedCompany.id)}
                    >
                      {trialMut.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Clock className="size-4" />
                      )}
                      {t("platformBilling.startTrial", { days: DEFAULT_TRIAL_DAYS })}
                    </Button>
                  )}
                  {overview?.checkoutConfigured && isCompanyScope && (
                    <>
                      <Select
                        value={checkoutPlan}
                        onValueChange={(v) => setCheckoutPlan(v as "standard" | "enterprise")}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">{planLabel("standard")}</SelectItem>
                          <SelectItem value="enterprise">{planLabel("enterprise")}</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={checkoutMut.isPending}
                        onClick={() =>
                          checkoutMut.mutate({ companyId: selectedCompany.id, plan: checkoutPlan })
                        }
                      >
                        {checkoutMut.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CreditCard className="size-4" />
                        )}
                        {t("platformBilling.pay")}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!selectedRow?.stripeCustomerId || portalMut.isPending}
                        onClick={() => portalMut.mutate(selectedCompany.id)}
                      >
                        <ExternalLink className="size-4" />
                        {t("platformBilling.portal")}
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {visibleGrants.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("platformBilling.aiGrantsTitle")}
                </p>
                <ul className="divide-y rounded-lg border text-sm">
                  {visibleGrants.map((g) => {
                    const name =
                      g.scope_type === "company"
                        ? selectedCompany?.name ?? t("platformBilling.company")
                        : companyBranches.find((b) => b.id === g.scope_id)?.name ?? g.scope_id;
                    return (
                      <li key={`${g.scope_type}:${g.scope_id}`} className="flex flex-wrap items-center gap-2 p-3">
                        <Badge variant="outline">
                          {g.scope_type === "company"
                            ? t("platformBilling.company")
                            : t("platformBilling.branch")}
                        </Badge>
                        <span className="font-medium truncate flex-1">{name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {g.quota_minutes == null ? "∞" : `${g.quota_minutes}`}
                          {" · "}
                          {t("platformBilling.minutesUsed", {
                            used: Number(g.used_minutes ?? 0).toFixed(1),
                          })}
                        </span>
                        {!g.is_active && (
                          <Badge variant="secondary">{t("platformBilling.off")}</Badge>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {visibleStorageGrants.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("platformBilling.storageGrantsTitle")}
                </p>
                <ul className="divide-y rounded-lg border text-sm">
                  {visibleStorageGrants.map((g) => {
                    const name =
                      g.scope_type === "company"
                        ? selectedCompany?.name ?? t("platformBilling.company")
                        : companyBranches.find((b) => b.id === g.scope_id)?.name ?? g.scope_id;
                    return (
                      <li
                        key={`storage:${g.scope_type}:${g.scope_id}`}
                        className="flex flex-wrap items-center gap-2 p-3"
                      >
                        <Badge variant="outline">
                          {g.scope_type === "company"
                            ? t("platformBilling.company")
                            : t("platformBilling.branch")}
                        </Badge>
                        <span className="font-medium truncate flex-1">{name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {mbToGbLabel(g.storage_quota_mb, unlimited)}
                          {" · "}
                          {t("platformBilling.storageUsed", {
                            used: formatUsedBytes(Number(g.used_bytes ?? 0)),
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        )}
      </Card>

      <Card className="card-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          {t("platformBilling.catalogTitle")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("platformBilling.catalogHint")}</p>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground">
                <th className="p-2 text-start font-medium">{t("platformBilling.colPlan")}</th>
                <th className="p-2 text-start font-medium">{t("platformBilling.colEmployees")}</th>
                <th className="p-2 text-start font-medium">{t("platformBilling.colBranches")}</th>
                <th className="p-2 text-start font-medium">{t("platformBilling.colRealtime")}</th>
                <th className="p-2 text-start font-medium">{t("platformBilling.colTrial")}</th>
              </tr>
            </thead>
            <tbody>
              {planEntitlements.map((row) => (
                <tr key={row.billing_plan} className="border-b last:border-0">
                  <td className="p-2 font-medium">{planLabel(row.billing_plan)}</td>
                  <td className="p-2 tabular-nums">
                    {formatLimit(row.max_employees, t("platformBilling.employeesUnit"), unlimited)}
                  </td>
                  <td className="p-2 tabular-nums">
                    {formatLimit(row.max_branches, t("platformBilling.branchesUnit"), unlimited)}
                  </td>
                  <td className="p-2">
                    {row.realtime_enabled ? t("platformBilling.yes") : t("platformBilling.no")}
                  </td>
                  <td className="p-2 tabular-nums">
                    {row.default_trial_days > 0
                      ? t("platformBilling.trialDays", { count: row.default_trial_days })
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {(overview?.payments?.length ?? 0) > 0 && (
        <Card className="card-elevated overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground">
              {t("platformBilling.recentPayments")}
            </h2>
          </div>
          <ul className="divide-y text-sm">
            {overview!.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                <span className="text-muted-foreground">
                  {p.paid_at
                    ? new Date(p.paid_at).toLocaleString(locale)
                    : new Date(p.created_at).toLocaleString(locale)}
                  {" · "}
                  {p.status}
                </span>
                <span className="font-medium">
                  {p.amount_cents != null
                    ? `${(p.amount_cents / 100).toFixed(2)} ${(p.currency ?? "").toUpperCase()}`
                    : "—"}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
