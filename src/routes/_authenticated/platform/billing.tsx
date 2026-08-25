import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CreditCard, ExternalLink, GitBranch, HardDrive, Loader2, Sparkles } from "lucide-react";
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
} from "@/lib/billing.functions";
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

const PLAN_LABELS: Record<BillingPlan, string> = {
  free: "חינמי (Free)",
  standard: "רגיל (Standard)",
  enterprise: "מיזם (Enterprise)",
};

const PLAN_TONES: Record<BillingPlan, string> = {
  free: "bg-muted text-muted-foreground",
  standard: "bg-sky-100 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400",
  enterprise: "bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-500",
};

const STATUS_HE: Record<string, string> = {
  active: "פעיל",
  trialing: "ניסיון",
  past_due: "באיחור",
  canceled: "בוטל",
  unpaid: "לא שולם",
  incomplete: "לא הושלם",
  incomplete_expired: "פג",
  paused: "מושהה",
  none: "אין מנוי",
};

const COMPANY_SCOPE = "__company__";
const OVERVIEW_KEY = ["platform-billing-overview"] as const;

function catalogMinutesLabel(minutes: number | null | undefined) {
  if (minutes == null) return "ללא הגבלה";
  return `${minutes} דק׳ / חודש`;
}

function PlatformBillingPage() {
  const { companies, isLoading: companiesLoading, activeCompanyId } = useCompanyContext();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const overviewFn = useServerFn(getBillingOverview);
  const setPlanFn = useServerFn(setManualBillingPlan);
  const saveAllocFn = useServerFn(saveBillingAllocation);
  const checkoutFn = useServerFn(createBillingCheckoutSession);
  const portalFn = useServerFn(createBillingPortalSession);

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
      toast.success("התשלום הושלם. המנוי יתעדכן אחרי אישור Stripe.");
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
      void navigate({ to: "/platform/billing", search: {}, replace: true });
    } else if (search.checkout === "cancel") {
      toast.message("התשלום בוטל");
      void navigate({ to: "/platform/billing", search: {}, replace: true });
    }
  }, [search.checkout, navigate, qc]);

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
      { id: COMPANY_SCOPE, label: "כל החברה" },
      ...companyBranches.map((b) => ({
        id: b.id,
        label: b.name,
        sublabel: b.code ?? undefined,
      })),
    ],
    [companyBranches],
  );
  const byCompany = useMemo(() => {
    const map = new Map((overviewQ.data?.companies ?? []).map((c) => [c.companyId, c]));
    return map;
  }, [overviewQ.data]);
  const entitlements = overviewQ.data?.entitlements ?? [];
  const grants = overviewQ.data?.grants ?? [];
  const storageEntitlements = overviewQ.data?.storageEntitlements ?? [];
  const storageGrants = overviewQ.data?.storageGrants ?? [];
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
      toast.success("התוכנית נשמרה במסד הנתונים");
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const saveAllocMut = useMutation({
    mutationFn: () => {
      if (!selectedCompanyId) throw new Error("בחרו חברה");
      const trimmed = draftMinutes.trim();
      const quotaMinutes = trimmed === "" ? null : Number(trimmed);
      if (quotaMinutes != null && !Number.isFinite(quotaMinutes)) {
        throw new Error("מספר דקות לא תקין");
      }
      const storageTrimmed = draftStorageGb.trim();
      const storageGb = storageTrimmed === "" ? null : Number(storageTrimmed);
      if (storageGb != null && (!Number.isFinite(storageGb) || storageGb < 0)) {
        throw new Error("נפח אחסון לא תקין");
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
      toast.success("התוכנית, ה-AI והאחסון נשמרו");
      void qc.invalidateQueries({ queryKey: OVERVIEW_KEY });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const checkoutMut = useMutation({
    mutationFn: (input: { companyId: string; plan: "standard" | "enterprise" }) =>
      checkoutFn({ data: input }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const portalMut = useMutation({
    mutationFn: (companyId: string) => portalFn({ data: { companyId } }),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const overview = overviewQ.data;
  const platformPlan = overview?.platform.plan ?? "free";
  const catalogForDraft = entitlements.find((e) => e.billing_plan === draftPlan);
  const storageCatalogForDraftMb = storageCatalogMb(draftPlan);

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <CreditCard className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">חיוב ומנויים (Billing &amp; Subscriptions)</h1>
          <p className="text-sm text-muted-foreground mt-1">
            תשלום Stripe לפי חברה. דקות AI ונפח אחסון לפי חברה או סניף — נקבעים כאן, לא ב-Stripe.
          </p>
        </div>
      </header>

      {overviewQ.isError && (
        <Card className="p-4 text-sm text-destructive">
          {overviewQ.error instanceof Error ? overviewQ.error.message : "טעינת החיוב נכשלה"}
        </Card>
      )}

      {overview && !overview.stripeConfigured && (
        <Card className="p-4 text-sm text-muted-foreground">
          Stripe עדיין לא מוגדר בשרת. בחירת תוכנית ידנית נשמרת. כדי לקבל תשלום אמיתי הוסיפו{" "}
          <code className="text-xs">STRIPE_SECRET_KEY</code>,{" "}
          <code className="text-xs">STRIPE_WEBHOOK_SECRET</code>,{" "}
          <code className="text-xs">STRIPE_PRICE_STANDARD</code> ו-
          <code className="text-xs">STRIPE_PRICE_ENTERPRISE</code>.
        </Card>
      )}

      {overview && (overview.storageEntitlements?.length ?? 0) === 0 && (
        <Card className="p-4 text-sm text-amber-900 bg-amber-50 border-amber-200">
          טבלאות מכסת האחסון עדיין לא הותקנו. הריצו ב-Supabase SQL את הקובץ{" "}
          <code className="text-xs">20260825130000_billing_storage_quotas.sql</code> ואז רעננו את
          העמוד.
        </Card>
      )}

      <Card className="card-elevated p-5 space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">מנוי הפלטפורמה</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Badge className={PLAN_TONES[platformPlan]}>{PLAN_LABELS[platformPlan]}</Badge>
          {overview?.platform.source && (
            <span className="text-xs text-muted-foreground">
              מקור: {overview.platform.source === "stripe" ? "Stripe" : "ידני"}
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
              {Object.entries(PLAN_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
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
            תוכנית והקצאה לפי חברה / סניף
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            בחרו חברה, אחר כך סניף או כל החברה. שמירה מעדכנת תוכנית, דקות AI ונפח אחסון.
          </p>
        </div>
        {companiesLoading || overviewQ.isLoading ? (
          <div className="text-sm text-muted-foreground">טוען…</div>
        ) : companies.length === 0 ? (
          <div className="text-sm text-muted-foreground">אין עדיין חברות בפלטפורמה</div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>חברה</Label>
                <SearchableSingleSelect
                  options={companyOptions}
                  value={selectedCompanyId}
                  onChange={(id) => {
                    setSelectedCompanyId(id);
                    setSelectedBranchId(COMPANY_SCOPE);
                  }}
                  placeholder="בחרו חברה…"
                  searchPlaceholder="הקלד לחיפוש לפי שם…"
                  emptyText="לא נמצאה חברה"
                />
              </div>
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <GitBranch className="size-3.5" />
                  סניף
                </Label>
                <SearchableSingleSelect
                  options={branchOptions}
                  value={selectedBranchId}
                  onChange={setSelectedBranchId}
                  placeholder="בחרו סניף…"
                  searchPlaceholder="הקלד לחיפוש סניף…"
                  emptyText="לא נמצא סניף"
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
                      {companyBranches.find((b) => b.id === selectedBranchId)?.name ?? "סניף"}
                    </Badge>
                  )}
                  <Badge className={PLAN_TONES[companyPlan]}>{PLAN_LABELS[companyPlan]}</Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  מנוי החברה: {STATUS_HE[selectedRow?.status ?? "none"] ?? selectedRow?.status ?? "אין מנוי"}
                  {selectedRow?.source ? ` · ${selectedRow.source === "stripe" ? "Stripe" : "ידני"}` : ""}
                  {selectedRow?.currentPeriodEnd
                    ? ` · עד ${new Date(selectedRow.currentPeriodEnd).toLocaleDateString("he-IL")}`
                    : ""}
                  {isCompanyScope
                    ? " · שמירה כאן מעדכנת את תוכנית התשלום של החברה"
                    : " · שמירה כאן מקצה AI ואחסון לסניף בלבד; התשלום נשאר ברמת החברה"}
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>תוכנית</Label>
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
                        {Object.entries(PLAN_LABELS).map(([value, label]) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      ברירת מחדל: {catalogMinutesLabel(catalogForDraft?.monthly_minutes)}
                      {" · "}
                      אחסון {mbToGbLabel(storageCatalogForDraftMb)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>דקות AI לחודש</Label>
                    <Input
                      type="number"
                      min={0}
                      placeholder="ריק = ללא הגבלה"
                      value={draftMinutes}
                      onChange={(e) => setDraftMinutes(e.target.value)}
                    />
                    {selectedGrant && (
                      <p className="text-xs text-muted-foreground">
                        נוצלו {Number(selectedGrant.used_minutes ?? 0).toFixed(1)} דק׳
                      </p>
                    )}
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label className="flex items-center gap-1.5">
                      <HardDrive className="size-3.5" />
                      נפח אחסון (GB)
                    </Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.1"
                      placeholder="ריק = ללא הגבלה"
                      value={draftStorageGb}
                      onChange={(e) => setDraftStorageGb(e.target.value)}
                      className="sm:max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      חינמי ברירת מחדל 0.5 GB · רגיל 10 GB · מיזם ללא הגבלה. אפשר לשנות ידנית.
                      {selectedStorageGrant
                        ? ` · בשימוש כעת: ${formatUsedBytes(Number(selectedStorageGrant.used_bytes ?? 0))}`
                        : ""}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Sparkles className="size-4 text-primary shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium">עוזר AI</p>
                      <p className="text-xs text-muted-foreground">מפעיל את המכסה שנשמרה למעלה</p>
                    </div>
                  </div>
                  <Switch checked={draftAiEnabled} onCheckedChange={setDraftAiEnabled} />
                </div>

                <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                  <p>
                    Stripe גובה כסף לפי Price ID — לא בוחר דקות, AI או אחסון. את אלה קובעים כאן.
                  </p>
                  <p>
                    מכסת האחסון נשמרת עכשיו. חסימת העלאות כשחורגים מהמכסה תתווסף בשלב הבא. ספקים
                    ויומן שימוש נשארים ב־ניהול AI.
                  </p>
                  <Link to="/platform/ai" className="text-primary underline-offset-2 hover:underline">
                    פתיחת ניהול AI (ספקים ושימוש)
                  </Link>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button onClick={() => saveAllocMut.mutate()} disabled={saveAllocMut.isPending}>
                    {saveAllocMut.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    שמור תוכנית והקצאה
                  </Button>
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
                          <SelectItem value="standard">{PLAN_LABELS.standard}</SelectItem>
                          <SelectItem value="enterprise">{PLAN_LABELS.enterprise}</SelectItem>
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
                        תשלום
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!selectedRow?.stripeCustomerId || portalMut.isPending}
                        onClick={() => portalMut.mutate(selectedCompany.id)}
                      >
                        <ExternalLink className="size-4" />
                        פורטל
                      </Button>
                    </>
                  )}
                </div>
              </div>
            )}

            {visibleGrants.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">הקצאות AI לחברה זו</p>
                <ul className="divide-y rounded-lg border text-sm">
                  {visibleGrants.map((g) => {
                    const name =
                      g.scope_type === "company"
                        ? selectedCompany?.name ?? "חברה"
                        : companyBranches.find((b) => b.id === g.scope_id)?.name ?? g.scope_id;
                    return (
                      <li key={`${g.scope_type}:${g.scope_id}`} className="flex flex-wrap items-center gap-2 p-3">
                        <Badge variant="outline">{g.scope_type === "company" ? "חברה" : "סניף"}</Badge>
                        <span className="font-medium truncate flex-1">{name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {g.quota_minutes == null ? "∞" : `${g.quota_minutes} דק׳`}
                          {" · "}
                          נוצלו {Number(g.used_minutes ?? 0).toFixed(1)}
                        </span>
                        {!g.is_active && <Badge variant="secondary">כבוי</Badge>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {visibleStorageGrants.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">מכסות אחסון לחברה זו</p>
                <ul className="divide-y rounded-lg border text-sm">
                  {visibleStorageGrants.map((g) => {
                    const name =
                      g.scope_type === "company"
                        ? selectedCompany?.name ?? "חברה"
                        : companyBranches.find((b) => b.id === g.scope_id)?.name ?? g.scope_id;
                    return (
                      <li key={`storage:${g.scope_type}:${g.scope_id}`} className="flex flex-wrap items-center gap-2 p-3">
                        <Badge variant="outline">{g.scope_type === "company" ? "חברה" : "סניף"}</Badge>
                        <span className="font-medium truncate flex-1">{name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {mbToGbLabel(g.storage_quota_mb)}
                          {" · "}
                          בשימוש {formatUsedBytes(Number(g.used_bytes ?? 0))}
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

      {(overview?.payments?.length ?? 0) > 0 && (
        <Card className="card-elevated overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-sm font-semibold text-muted-foreground">תשלומים אחרונים</h2>
          </div>
          <ul className="divide-y text-sm">
            {overview!.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 p-3">
                <span className="text-muted-foreground">
                  {p.paid_at
                    ? new Date(p.paid_at).toLocaleString("he-IL")
                    : new Date(p.created_at).toLocaleString("he-IL")}
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
