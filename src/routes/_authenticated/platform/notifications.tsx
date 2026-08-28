import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Bell, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  addPlatformPushScope,
  listPlatformPushScopes,
  listPlatformPushSettings,
  removePlatformPushScope,
  setPlatformPushSetting,
} from "@/lib/platform-push-settings.functions";
import type { PlatformPushEventKey } from "@/lib/platform-push-events";

export const Route = createFileRoute("/_authenticated/platform/notifications")({
  component: PlatformNotificationsPage,
});

const PUSH_GROUPS = ["schedule", "leave", "break", "custody", "ops"] as const;

type PushSettingRow = {
  key: PlatformPushEventKey;
  label: string;
  group: string;
  pushEnabled: boolean;
  updatedAt: string | null;
};

function PlatformNotificationsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [scopeMode, setScopeMode] = useState<"company" | "branch">("company");
  const [selectedCompanyId, setSelectedCompanyId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");

  const listFn = useServerFn(listPlatformPushSettings);
  const setFn = useServerFn(setPlatformPushSetting);
  const listScopesFn = useServerFn(listPlatformPushScopes);
  const addScopeFn = useServerFn(addPlatformPushScope);
  const removeScopeFn = useServerFn(removePlatformPushScope);

  const settingsQ = useQuery({
    queryKey: ["platform-push-settings"],
    queryFn: () => listFn() as Promise<PushSettingRow[]>,
  });
  const scopesQ = useQuery({
    queryKey: ["platform-push-scopes"],
    queryFn: () => listScopesFn(),
  });

  const toggleMut = useMutation({
    mutationFn: async (input: { eventKey: PlatformPushEventKey; pushEnabled: boolean }) =>
      setFn({ data: input }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-push-settings"] });
      toast.success(t("platformNotifications.pushUpdated"));
    },
    onError: (error: Error) => toast.error(error.message ?? t("platformNotifications.updateFailed")),
  });

  const addScopeMut = useMutation({
    mutationFn: async () => {
      if (scopeMode === "company") {
        if (!selectedCompanyId) throw new Error(t("platformNotifications.selectCompanyError"));
        return addScopeFn({ data: { companyId: selectedCompanyId } });
      }
      if (!selectedBranchId) throw new Error(t("platformNotifications.selectBranchError"));
      return addScopeFn({ data: { branchId: selectedBranchId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-push-scopes"] });
      setSelectedCompanyId("");
      setSelectedBranchId("");
      toast.success(t("platformNotifications.scopeAdded"));
    },
    onError: (error: Error) => toast.error(error.message ?? t("platformNotifications.scopeAddFailed")),
  });

  const removeScopeMut = useMutation({
    mutationFn: async (id: string) => removeScopeFn({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platform-push-scopes"] });
      toast.success(t("platformNotifications.scopeRemoved"));
    },
    onError: (error: Error) => toast.error(error.message ?? t("platformNotifications.scopeRemoveFailed")),
  });

  const grouped = (settingsQ.data ?? []).reduce<Record<string, PushSettingRow[]>>((acc, row) => {
    (acc[row.group] ??= []).push(row);
    return acc;
  }, {});

  const grantedCompanyIds = useMemo(
    () => new Set((scopesQ.data?.scopes ?? []).map((s) => s.companyId).filter(Boolean)),
    [scopesQ.data],
  );
  const grantedBranchIds = useMemo(
    () => new Set((scopesQ.data?.scopes ?? []).map((s) => s.branchId).filter(Boolean)),
    [scopesQ.data],
  );

  const availableCompanies = (scopesQ.data?.companies ?? []).filter(
    (c) => !grantedCompanyIds.has(c.id),
  );
  const availableBranches = (scopesQ.data?.branches ?? []).filter(
    (b) => !grantedBranchIds.has(b.id),
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Bell className="size-6" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformNotifications.title")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("platformNotifications.subtitle")}
          </p>
        </div>
      </header>

      <Card className="card-elevated p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{t("platformNotifications.scopeTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("platformNotifications.scopeDesc")}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-2 min-w-[140px]">
            <Label>{t("platformNotifications.scopeType")}</Label>
            <Select
              value={scopeMode}
              onValueChange={(v) => setScopeMode(v as "company" | "branch")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="company">{t("platformNotifications.company")}</SelectItem>
                <SelectItem value="branch">{t("platformNotifications.branch")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {scopeMode === "company" ? (
            <div className="space-y-2 min-w-[220px] flex-1">
              <Label>{t("platformNotifications.company")}</Label>
              <Select value={selectedCompanyId} onValueChange={setSelectedCompanyId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("platformNotifications.selectCompany")} />
                </SelectTrigger>
                <SelectContent>
                  {availableCompanies.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2 min-w-[220px] flex-1">
              <Label>{t("platformNotifications.branch")}</Label>
              <Select value={selectedBranchId} onValueChange={setSelectedBranchId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("platformNotifications.selectBranch")} />
                </SelectTrigger>
                <SelectContent>
                  {availableBranches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <Button
            size="sm"
            className="gap-2"
            disabled={addScopeMut.isPending}
            onClick={() => addScopeMut.mutate()}
          >
            <Plus className="size-4" />
            {t("platformNotifications.grantPush")}
          </Button>
        </div>
        {scopesQ.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("platformNotifications.loadingScopes")}</p>
        ) : (scopesQ.data?.scopes?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground rounded-lg border border-dashed p-4">
            {t("platformNotifications.noScopes")}
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {scopesQ.data!.scopes.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 px-3 py-3">
                <p className="text-sm font-medium">{s.label}</p>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  disabled={removeScopeMut.isPending}
                  onClick={() => removeScopeMut.mutate(s.id)}
                  aria-label={t("platformNotifications.removeScopeAria")}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="card-elevated p-4 sm:p-6 space-y-5">
        <div>
          <h2 className="text-lg font-semibold">{t("platformNotifications.eventsTitle")}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {t("platformNotifications.eventsDesc")}
          </p>
        </div>
        {settingsQ.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("platformNotifications.loadingSettings")}</p>
        ) : settingsQ.isError ? (
          <p className="text-sm text-destructive">
            {(settingsQ.error as Error)?.message ?? t("platformNotifications.loadError")}
          </p>
        ) : (
          <div className="space-y-6">
            {PUSH_GROUPS.map((group) => {
              const rows = grouped[group] ?? [];
              if (!rows.length) return null;
              return (
                <div key={group} className="space-y-3">
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {t(`platformNotifications.groups.${group}`)}
                  </h3>
                  <ul className="divide-y rounded-lg border">
                    {rows.map((row) => (
                      <li
                        key={row.key}
                        className="flex items-center justify-between gap-3 px-3 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{row.label}</p>
                          <p className="text-xs text-muted-foreground">{row.key}</p>
                        </div>
                        <Switch
                          checked={row.pushEnabled}
                          disabled={toggleMut.isPending}
                          onCheckedChange={(checked) =>
                            toggleMut.mutate({ eventKey: row.key, pushEnabled: checked })
                          }
                          aria-label={row.label}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
