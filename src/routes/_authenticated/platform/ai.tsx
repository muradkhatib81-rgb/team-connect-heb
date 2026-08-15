import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompanyContext } from "@/platform";
import { branchService } from "@/modules/branches";
import {
  deleteAiGrant,
  getAiPlatformSettings,
  listAiGrants,
  listAiPlanEntitlements,
  listAiProviders,
  listAiUsageEvents,
  syncCompanyAiGrantFromBillingPlan,
  updateAiPlatformSettings,
  updateAiProviderEnabled,
  upsertAiGrant,
} from "@/lib/ai.functions";
import type { BillingPlan } from "@/core/managers/billing-manager";
import { useTranslation } from "react-i18next";
import { aiErrorCode, translateAiError } from "@/lib/ai-errors";

export const Route = createFileRoute("/_authenticated/platform/ai")({
  component: PlatformAiPage,
});

const GRANTS_KEY = ["platform-ai-grants"] as const;
const PROVIDERS_KEY = ["platform-ai-providers"] as const;
const USAGE_KEY = ["platform-ai-usage"] as const;
const SETTINGS_KEY = ["platform-ai-settings"] as const;
const ENTITLEMENTS_KEY = ["platform-ai-entitlements"] as const;

function PlatformAiPage() {
  const { t, i18n } = useTranslation();
  const dateLocale =
    i18n.language === "ar" ? "ar-SA" : i18n.language === "en" ? "en-US" : "he-IL";
  const qc = useQueryClient();
  const { companies } = useCompanyContext();
  const [grantOpen, setGrantOpen] = useState(false);
  const [scopeType, setScopeType] = useState<"company" | "branch">("company");
  const [scopeId, setScopeId] = useState("");
  const [providerCode, setProviderCode] = useState<string>("");
  const [grantSource, setGrantSource] = useState<"manual_free" | "manual_paid" | "billing_plan">(
    "manual_free",
  );
  const [quotaMinutes, setQuotaMinutes] = useState("");
  const [billingPlan, setBillingPlan] = useState<BillingPlan>("free");

  const listGrantsFn = useServerFn(listAiGrants);
  const listProvidersFn = useServerFn(listAiProviders);
  const listUsageFn = useServerFn(listAiUsageEvents);
  const listEntFn = useServerFn(listAiPlanEntitlements);
  const getSettingsFn = useServerFn(getAiPlatformSettings);
  const upsertGrantFn = useServerFn(upsertAiGrant);
  const deleteGrantFn = useServerFn(deleteAiGrant);
  const syncBillingFn = useServerFn(syncCompanyAiGrantFromBillingPlan);
  const updateProviderFn = useServerFn(updateAiProviderEnabled);
  const updateSettingsFn = useServerFn(updateAiPlatformSettings);

  const branchesQ = useQuery({
    queryKey: ["platform-all-branches"],
    queryFn: () => branchService.listAllBranches(),
  });

  const grantsQ = useQuery({ queryKey: GRANTS_KEY, queryFn: () => listGrantsFn() });
  const providersQ = useQuery({ queryKey: PROVIDERS_KEY, queryFn: () => listProvidersFn() });
  const usageQ = useQuery({ queryKey: USAGE_KEY, queryFn: () => listUsageFn() });
  const entQ = useQuery({ queryKey: ENTITLEMENTS_KEY, queryFn: () => listEntFn() });
  const settingsQ = useQuery({ queryKey: SETTINGS_KEY, queryFn: () => getSettingsFn() });

  const scopeLabels = useMemo(() => {
    const companyMap = new Map(companies.map((c) => [c.id, c.name]));
    const branchMap = new Map((branchesQ.data ?? []).map((b) => [b.id, b.name]));
    return { companyMap, branchMap };
  }, [companies, branchesQ.data]);

  const saveGrantMut = useMutation({
    mutationFn: async () => {
      if (!scopeId) throw new Error(aiErrorCode("selectScope"));
      if (grantSource === "billing_plan" && scopeType !== "company") {
        throw new Error(aiErrorCode("billingPlanCompanyOnly"));
      }
      if (grantSource === "billing_plan") {
        return syncBillingFn({ data: { companyId: scopeId, plan: billingPlan } });
      }
      return upsertGrantFn({
        data: {
          scopeType,
          scopeId,
          providerCode: providerCode && providerCode !== "default" ? providerCode : null,
          grantSource,
          billingPlan: null,
          quotaMinutes: quotaMinutes === "" ? null : Number(quotaMinutes),
          quotaPeriod: "monthly",
          isActive: true,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GRANTS_KEY });
      setGrantOpen(false);
      toast.success(t("ai.platformAdmin.grantSaved"));
    },
    onError: (e: Error) => toast.error(translateAiError(e.message, t)),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteGrantFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GRANTS_KEY });
      toast.success(t("ai.platformAdmin.grantDeleted"));
    },
    onError: (e: Error) => toast.error(translateAiError(e.message, t)),
  });

  const settings = settingsQ.data;

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Sparkles className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("ai.platformAdmin.pageTitle")}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t("ai.platformAdmin.pageSubtitle")}</p>
        </div>
        <Button className="ms-auto gap-2" onClick={() => setGrantOpen(true)}>
          <Plus className="size-4" />
          {t("ai.platformAdmin.newGrant")}
        </Button>
      </header>

      <Tabs defaultValue="grants">
        <TabsList>
          <TabsTrigger value="grants">{t("ai.platformAdmin.tabs.grants")}</TabsTrigger>
          <TabsTrigger value="providers">{t("ai.platformAdmin.tabs.providers")}</TabsTrigger>
          <TabsTrigger value="billing">{t("ai.platformAdmin.tabs.billing")}</TabsTrigger>
          <TabsTrigger value="usage">{t("ai.platformAdmin.tabs.usage")}</TabsTrigger>
          <TabsTrigger value="settings">{t("ai.platformAdmin.tabs.settings")}</TabsTrigger>
        </TabsList>

        <TabsContent value="grants" className="mt-4">
          <Card className="card-elevated overflow-hidden">
            {grantsQ.isLoading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : (grantsQ.data ?? []).length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground text-center">{t("ai.platformAdmin.noGrants")}</div>
            ) : (
              <ul className="divide-y">
                {(grantsQ.data ?? []).map((g: any) => {
                  const label =
                    g.scope_type === "company"
                      ? scopeLabels.companyMap.get(g.scope_id) ?? g.scope_id
                      : scopeLabels.branchMap.get(g.scope_id) ?? g.scope_id;
                  return (
                    <li key={g.id} className="flex flex-wrap items-center gap-3 p-4">
                      <Badge variant="outline">{t(`ai.scope.${g.scope_type as "company" | "branch" | "user"}`)}</Badge>
                      <span className="font-medium truncate flex-1">{label}</span>
                      <Badge>{t(`ai.grantSource.${g.grant_source as "manual_free" | "manual_paid" | "billing_plan"}`)}</Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {g.quota_minutes ?? "∞"} · {t("ai.minutesUsed", { used: Number(g.used_minutes).toFixed(1) })}
                      </span>
                      <span className="text-xs">{g.provider_code ?? t("ai.defaultProvider")}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => deleteMut.mutate(g.id)}
                        disabled={deleteMut.isPending}
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="providers" className="mt-4">
          <Card className="card-elevated divide-y">
            {(providersQ.data ?? []).map((p: any) => (
              <div key={p.code} className="flex items-center gap-3 p-4">
                <Bot className="size-4 text-primary" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{p.display_name}</p>
                  <p className="text-xs text-muted-foreground">{p.code} · {p.default_model}</p>
                </div>
                <Switch
                  checked={p.is_enabled}
                  onCheckedChange={(enabled) =>
                    updateProviderFn({ data: { code: p.code, isEnabled: enabled } }).then(() =>
                      qc.invalidateQueries({ queryKey: PROVIDERS_KEY }),
                    )
                  }
                />
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4">
          <Card className="card-elevated divide-y">
            {(entQ.data ?? []).map((e: any) => (
              <div key={e.billing_plan} className="p-4 flex flex-wrap gap-3 items-center">
                <Badge>{e.billing_plan}</Badge>
                <span className="text-sm">
                  {e.monthly_minutes != null
                    ? t("ai.minutesPerMonth", { count: e.monthly_minutes })
                    : t("ai.minutesPerMonthUnlimited")}
                </span>
                <span className="text-sm text-muted-foreground">{e.default_provider_code}</span>
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Card className="card-elevated overflow-hidden">
            {(usageQ.data ?? []).length === 0 ? (
              <div className="p-8 text-sm text-muted-foreground text-center">{t("ai.platformAdmin.noUsage")}</div>
            ) : (
              <ul className="divide-y text-sm">
                {(usageQ.data ?? []).map((u: any) => (
                  <li key={u.id} className="p-3 flex flex-wrap gap-2">
                    <Badge variant="outline">{t(`ai.assistantKind.${u.assistant_kind as "employee" | "manager" | "platform_owner"}`)}</Badge>
                    <span>{u.provider_code}</span>
                    <span className="text-muted-foreground">{u.model}</span>
                    <span className="ms-auto tabular-nums text-xs text-muted-foreground">
                      {new Date(u.created_at).toLocaleString(dateLocale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-4">
          <Card className="card-elevated p-5 space-y-4 max-w-lg">
            <div className="space-y-2">
              <Label>{t("ai.platformAdmin.defaultProviderSetting")}</Label>
              <Select
                value={settings?.default_provider_code ?? "gemini"}
                onValueChange={(v) =>
                  updateSettingsFn({
                    data: {
                      defaultProviderCode: v,
                      ownerMonthlyMinutes: settings?.owner_monthly_minutes ?? null,
                      isGloballyEnabled: settings?.is_globally_enabled ?? true,
                    },
                  }).then(() => qc.invalidateQueries({ queryKey: SETTINGS_KEY }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(providersQ.data ?? []).map((p: any) => (
                    <SelectItem key={p.code} value={p.code}>
                      {p.display_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("ai.platformAdmin.ownerQuotaLabel")}</Label>
              <Input
                type="number"
                defaultValue={settings?.owner_monthly_minutes ?? ""}
                onBlur={(e) => {
                  const val = e.target.value === "" ? null : Number(e.target.value);
                  updateSettingsFn({
                    data: {
                      defaultProviderCode: settings?.default_provider_code ?? "gemini",
                      ownerMonthlyMinutes: val,
                      isGloballyEnabled: settings?.is_globally_enabled ?? true,
                    },
                  }).then(() => qc.invalidateQueries({ queryKey: SETTINGS_KEY }));
                }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Label>{t("ai.platformAdmin.globallyEnabled")}</Label>
              <Switch
                checked={settings?.is_globally_enabled ?? true}
                onCheckedChange={(enabled) =>
                  updateSettingsFn({
                    data: {
                      defaultProviderCode: settings?.default_provider_code ?? "gemini",
                      ownerMonthlyMinutes: settings?.owner_monthly_minutes ?? null,
                      isGloballyEnabled: enabled,
                    },
                  }).then(() => qc.invalidateQueries({ queryKey: SETTINGS_KEY }))
                }
              />
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("ai.platformAdmin.grantDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>{t("ai.platformAdmin.scopeLabel")}</Label>
              <Select value={scopeType} onValueChange={(v) => setScopeType(v as "company" | "branch")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="company">{t("ai.scope.company")}</SelectItem>
                  <SelectItem value="branch">{t("ai.scope.branch")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{scopeType === "company" ? t("ai.scope.company") : t("ai.scope.branch")}</Label>
              <Select value={scopeId} onValueChange={setScopeId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("ai.platformAdmin.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {scopeType === "company"
                    ? companies.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))
                    : (branchesQ.data ?? []).map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("ai.platformAdmin.grantSourceLabel")}</Label>
              <Select
                value={grantSource}
                onValueChange={(v) =>
                  setGrantSource(v as "manual_free" | "manual_paid" | "billing_plan")
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual_free">{t("ai.grantSource.manual_free")}</SelectItem>
                  <SelectItem value="manual_paid">{t("ai.grantSource.manual_paid")}</SelectItem>
                  <SelectItem value="billing_plan">{t("ai.grantSource.billing_plan")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {grantSource === "billing_plan" ? (
              <div className="space-y-2">
                <Label>{t("ai.platformAdmin.planLabel")}</Label>
                <Select value={billingPlan} onValueChange={(v) => setBillingPlan(v as BillingPlan)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="free">free</SelectItem>
                    <SelectItem value="standard">standard</SelectItem>
                    <SelectItem value="enterprise">enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{t("ai.platformAdmin.providerLabel")}</Label>
                  <Select value={providerCode || "default"} onValueChange={setProviderCode}>
                    <SelectTrigger>
                      <SelectValue placeholder={t("ai.defaultProvider")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t("ai.defaultProvider")}</SelectItem>
                      {(providersQ.data ?? []).map((p: any) => (
                        <SelectItem key={p.code} value={p.code}>
                          {p.display_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{t("ai.platformAdmin.minutesLabel")}</Label>
                  <Input
                    type="number"
                    value={quotaMinutes}
                    onChange={(e) => setQuotaMinutes(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={() => saveGrantMut.mutate()} disabled={saveGrantMut.isPending}>
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
