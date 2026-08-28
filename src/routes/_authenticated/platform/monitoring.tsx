import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useTranslation } from "react-i18next";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCcw,
  Building2,
  GitBranch,
  ScrollText,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getPlatformHealthDashboard,
  triggerPlatformHealthScan,
  type PlatformHealthEvent,
  type PlatformHealthSnapshot,
} from "@/lib/platform-health.functions";
import { usePlatformContext } from "@/platform";
import type { HealthState } from "@/core/monitoring/types";
import { intlLocaleForApp } from "@/lib/app-locale";

export const Route = createFileRoute("/_authenticated/platform/monitoring")({
  component: PlatformMonitoringPage,
});

const STATE_ICONS: Record<HealthState, typeof CheckCircle2> = {
  healthy: CheckCircle2,
  degraded: AlertTriangle,
  down: XCircle,
  unknown: HelpCircle,
};

const STATE_CLASS: Record<HealthState, string> = {
  healthy: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400",
  degraded: "text-amber-600 bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400",
  down: "text-rose-600 bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400",
  unknown: "text-muted-foreground bg-muted",
};

function formatWhen(iso: string | null | undefined, lang: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(intlLocaleForApp(lang), { timeZone: "Asia/Jerusalem" });
  } catch {
    return iso;
  }
}

function formatProbeMessage(
  target: string,
  message: string | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  if (!message) return null;
  if (target === "managers") {
    const match = /^system_services:(\d+)$/.exec(message.trim());
    const count = match ? Number(match[1]) : Number.parseInt(message.replace(/\D/g, ""), 10);
    if (!Number.isFinite(count) || count <= 0) return t("platformMonitoring.systemServicesNone");
    return t("platformMonitoring.systemServicesCount", { count });
  }
  return message;
}

function SnapshotCard({ row }: { row: PlatformHealthSnapshot }) {
  const { t, i18n } = useTranslation();
  const state = (row.state in STATE_CLASS ? row.state : "unknown") as HealthState;
  const Icon = STATE_ICONS[state];
  const className = STATE_CLASS[state];
  const kindLabel = t(`platformMonitoring.kind.${row.target_kind}`, {
    defaultValue: row.target_kind,
  });

  return (
    <Card className="card-elevated p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{row.target_name || kindLabel}</p>
          <p className="text-[11px] text-muted-foreground">{kindLabel}</p>
        </div>
        <div className={`size-8 shrink-0 rounded-lg flex items-center justify-center ${className}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <Badge variant="outline" className={className.replace("bg-", "border-")}>
        {t(`platformMonitoring.state.${state}`)}
      </Badge>
      {row.message && (
        <p className="text-[11px] text-muted-foreground break-words" dir="auto">
          {row.message}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">
        {t("platformMonitoring.checkedAt", { when: formatWhen(row.checked_at, i18n.language) })}
      </p>
    </Card>
  );
}

function EventRow({ row }: { row: PlatformHealthEvent }) {
  const { t, i18n } = useTranslation();
  const state = (row.state in STATE_CLASS ? row.state : "unknown") as HealthState;
  const className = STATE_CLASS[state];

  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 border-b border-border/60 py-3 last:border-0">
      <div className="sm:w-40 shrink-0 text-[11px] text-muted-foreground">
        {formatWhen(row.created_at, i18n.language)}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            {t(`platformMonitoring.event.${row.event_type}`, { defaultValue: row.event_type })}
          </Badge>
          <Badge variant="outline" className={className.replace("bg-", "border-")}>
            {t(`platformMonitoring.state.${state}`)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {t(`platformMonitoring.kind.${row.target_kind}`, { defaultValue: row.target_kind })}
          </span>
        </div>
        <p className="text-sm font-medium truncate">{row.target_name || "—"}</p>
        <p className="text-xs text-muted-foreground break-words" dir="auto">
          {row.message}
        </p>
      </div>
    </div>
  );
}

function PlatformMonitoringPage() {
  const { t, i18n } = useTranslation();
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();
  const loadDashboard = useServerFn(getPlatformHealthDashboard);
  const runScan = useServerFn(triggerPlatformHealthScan);

  const healthQuery = useQuery({
    queryKey: ["platform-monitoring", "stored-health"],
    queryFn: () => loadDashboard(),
    refetchInterval: 60_000,
  });

  const liveInfraQuery = useQuery({
    queryKey: ["platform-monitoring", "live-infra"],
    queryFn: () => runtime.getGlobalMonitoring(),
    refetchInterval: 60_000,
  });

  const scanMutation = useMutation({
    mutationFn: () => runScan(),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ["platform-monitoring", "stored-health"] });
      if (!result.ok) {
        toast.error(result.error ?? t("platformMonitoring.scanFailed"));
        return;
      }
      toast.success(
        t("platformMonitoring.scanOk", {
          companies: result.companies_checked ?? 0,
          branches: result.branches_checked ?? 0,
        }),
      );
    },
    onError: (e: Error) => toast.error(e.message ?? t("platformMonitoring.scanFailed")),
  });

  const snapshots = healthQuery.data?.snapshots ?? [];
  const events = healthQuery.data?.events ?? [];

  const platformRows = useMemo(
    () => snapshots.filter((s) => s.target_kind === "platform" || s.target_kind === "database"),
    [snapshots],
  );
  const companyRows = useMemo(
    () => snapshots.filter((s) => s.target_kind === "company"),
    [snapshots],
  );
  const branchRows = useMemo(
    () => snapshots.filter((s) => s.target_kind === "branch"),
    [snapshots],
  );

  const issueCount = snapshots.filter((s) => s.state !== "healthy").length;
  const lastChecked = snapshots
    .map((s) => s.checked_at)
    .filter(Boolean)
    .sort()
    .at(-1);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Activity className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">{t("platformMonitoring.title")}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t("platformMonitoring.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => healthQuery.refetch()}
            disabled={healthQuery.isFetching}
          >
            <RefreshCcw className={`size-4 ${healthQuery.isFetching ? "animate-spin" : ""}`} />
            {t("platformMonitoring.refreshView")}
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            <Play className="size-4" />
            {scanMutation.isPending ? t("platformMonitoring.running") : t("platformMonitoring.runNow")}
          </Button>
        </div>
      </header>

      <Card className="card-elevated p-4 flex flex-wrap items-center gap-3">
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
          {t("platformMonitoring.healthyCount", {
            ok: snapshots.length - issueCount,
            total: snapshots.length,
          })}
        </Badge>
        <Badge variant="outline">
          {t("platformMonitoring.companiesCount", { count: companyRows.length })}
        </Badge>
        <Badge variant="outline">
          {t("platformMonitoring.branchesCount", { count: branchRows.length })}
        </Badge>
        {issueCount > 0 && (
          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            {t("platformMonitoring.openFindings", { count: issueCount })}
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          {t("platformMonitoring.scanHint", {
            when: formatWhen(lastChecked, i18n.language),
          })}
        </p>
      </Card>

      {healthQuery.isLoading ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">
          {t("platformMonitoring.loadingStored")}
        </Card>
      ) : snapshots.length === 0 ? (
        <Card className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">{t("platformMonitoring.emptyStored")}</p>
          <Button size="sm" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            {t("platformMonitoring.runFirst")}
          </Button>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="size-4" /> {t("platformMonitoring.sectionPlatform")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {platformRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="size-4" /> {t("platformMonitoring.sectionCompanies")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {companyRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
              {companyRows.length === 0 && (
                <Card className="p-4 text-sm text-muted-foreground">
                  {t("platformMonitoring.noCompanies")}
                </Card>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="size-4" /> {t("platformMonitoring.sectionBranches")}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {branchRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
              {branchRows.length === 0 && (
                <Card className="p-4 text-sm text-muted-foreground">
                  {t("platformMonitoring.noBranches")}
                </Card>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ScrollText className="size-4" /> {t("platformMonitoring.sectionEvents")}
            </h2>
            <Card className="card-elevated p-4">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("platformMonitoring.noEvents")}</p>
              ) : (
                events.map((row) => <EventRow key={row.id} row={row} />)
              )}
            </Card>
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">{t("platformMonitoring.sectionLiveInfra")}</h2>
        <p className="text-xs text-muted-foreground">{t("platformMonitoring.liveInfraHint")}</p>
        {liveInfraQuery.isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            {t("platformMonitoring.checking")}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(liveInfraQuery.data ?? []).map((result) => {
              const state = (result.state in STATE_CLASS ? result.state : "unknown") as HealthState;
              const Icon = STATE_ICONS[state];
              const className = STATE_CLASS[state];
              const probeMessage = formatProbeMessage(result.target, result.message, t);
              return (
                <Card key={result.id} className="card-elevated p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t(`platformMonitoring.kind.${result.target}`, {
                        defaultValue: result.target,
                      })}
                    </span>
                    <div
                      className={`size-8 shrink-0 rounded-lg flex items-center justify-center ${className}`}
                    >
                      <Icon className="size-4" />
                    </div>
                  </div>
                  <Badge variant="outline" className={className.replace("bg-", "border-")}>
                    {t(`platformMonitoring.state.${state}`)}
                  </Badge>
                  {probeMessage && (
                    <p className="text-[11px] text-muted-foreground break-words" dir="auto">
                      {probeMessage}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
