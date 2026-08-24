import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
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

export const Route = createFileRoute("/_authenticated/platform/monitoring")({
  component: PlatformMonitoringPage,
});

const STATE_META: Record<
  HealthState,
  { label: string; icon: typeof CheckCircle2; className: string }
> = {
  healthy: {
    label: "תקין",
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-100 dark:bg-emerald-950/30 dark:text-emerald-400",
  },
  degraded: {
    label: "מוגבל / אזהרה",
    icon: AlertTriangle,
    className: "text-amber-600 bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400",
  },
  down: {
    label: "לא זמין",
    icon: XCircle,
    className: "text-rose-600 bg-rose-100 dark:bg-rose-950/30 dark:text-rose-400",
  },
  unknown: { label: "לא ידוע", icon: HelpCircle, className: "text-muted-foreground bg-muted" },
};

const KIND_LABEL: Record<string, string> = {
  platform: "פלטפורמה",
  company: "חברה",
  branch: "סניף",
  database: "מסד נתונים",
  api: "API",
};

const EVENT_LABEL: Record<string, string> = {
  issue: "תקלה",
  recovery: "התאוששות",
  overload: "עומס",
};

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("he-IL", { timeZone: "Asia/Jerusalem" });
  } catch {
    return iso;
  }
}

function SnapshotCard({ row }: { row: PlatformHealthSnapshot }) {
  const meta = STATE_META[row.state] ?? STATE_META.unknown;
  const Icon = meta.icon;
  return (
    <Card className="card-elevated p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{row.target_name || KIND_LABEL[row.target_kind]}</p>
          <p className="text-[11px] text-muted-foreground">{KIND_LABEL[row.target_kind] ?? row.target_kind}</p>
        </div>
        <div className={`size-8 shrink-0 rounded-lg flex items-center justify-center ${meta.className}`}>
          <Icon className="size-4" />
        </div>
      </div>
      <Badge variant="outline" className={meta.className.replace("bg-", "border-")}>
        {meta.label}
      </Badge>
      {row.message && (
        <p className="text-[11px] text-muted-foreground break-words" dir="auto">
          {row.message}
        </p>
      )}
      <p className="text-[11px] text-muted-foreground">נבדק: {formatWhen(row.checked_at)}</p>
    </Card>
  );
}

function EventRow({ row }: { row: PlatformHealthEvent }) {
  const meta = STATE_META[row.state] ?? STATE_META.unknown;
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 border-b border-border/60 py-3 last:border-0">
      <div className="sm:w-40 shrink-0 text-[11px] text-muted-foreground">{formatWhen(row.created_at)}</div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{EVENT_LABEL[row.event_type] ?? row.event_type}</Badge>
          <Badge variant="outline" className={meta.className.replace("bg-", "border-")}>
            {meta.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {KIND_LABEL[row.target_kind] ?? row.target_kind}
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
  const { runtime } = usePlatformContext();
  const qc = useQueryClient();
  const loadDashboard = useServerFn(getPlatformHealthDashboard);
  const runScan = useServerFn(triggerPlatformHealthScan);

  const healthQuery = useQuery({
    queryKey: ["platform-monitoring", "stored-health"],
    queryFn: () => loadDashboard(),
    refetchInterval: 60_000,
  });

  // Keep existing light infra probes as a secondary live section (client read-only).
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
        toast.error(result.error ?? "הבדיקה נכשלה");
        return;
      }
      toast.success(
        `בדיקה הושלמה · חברות ${result.companies_checked ?? 0} · סניפים ${result.branches_checked ?? 0}`,
      );
    },
    onError: (e: Error) => toast.error(e.message ?? "הבדיקה נכשלה"),
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
            <h1 className="truncate text-2xl sm:text-3xl font-bold">ניטור פלטפורמה</h1>
            <p className="text-sm text-muted-foreground mt-1">
              בדיקה שרתית לכל החברות והסניפים — כולל עתידיים. הדף רק מציג תוצאות שמורות, בלי
              להעמיס על האפליקציה.
            </p>
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
            רענון תצוגה
          </Button>
          <Button
            size="sm"
            className="gap-2"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending}
          >
            <Play className="size-4" />
            {scanMutation.isPending ? "בודק…" : "הרץ בדיקה עכשיו"}
          </Button>
        </div>
      </header>

      <Card className="card-elevated p-4 flex flex-wrap items-center gap-3">
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
          {snapshots.length - issueCount} / {snapshots.length} תקינים
        </Badge>
        <Badge variant="outline">{companyRows.length} חברות</Badge>
        <Badge variant="outline">{branchRows.length} סניפים</Badge>
        {issueCount > 0 && (
          <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
            {issueCount} ממצאים פתוחים
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">
          סריקה אוטומטית מהשרת (מקומי כל 20 דקות · בפרודקשן לפחות פעם ביום + כפתור ידני).
          עדכון תצוגה כל דקה. בדיקה אחרונה: {formatWhen(lastChecked)}
        </p>
      </Card>

      {healthQuery.isLoading ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">טוען ניטור שמור…</Card>
      ) : snapshots.length === 0 ? (
        <Card className="p-6 space-y-3">
          <p className="text-sm text-muted-foreground">
            עדיין אין תוצאות שמורות. זה תקין לפני הרצת המיגרציה הראשונה / הסריקה הראשונה.
          </p>
          <Button size="sm" onClick={() => scanMutation.mutate()} disabled={scanMutation.isPending}>
            הרץ בדיקה ראשונה מהשרת
          </Button>
        </Card>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Activity className="size-4" /> סיכום פלטפורמה
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {platformRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Building2 className="size-4" /> כל החברות
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {companyRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
              {companyRows.length === 0 && (
                <Card className="p-4 text-sm text-muted-foreground">אין חברות לבדיקה</Card>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="size-4" /> כל הסניפים
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {branchRows.map((row) => (
                <SnapshotCard key={row.id} row={row} />
              ))}
              {branchRows.length === 0 && (
                <Card className="p-4 text-sm text-muted-foreground">אין סניפים לבדיקה</Card>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <ScrollText className="size-4" /> יומן תקלות / עומס / התאוששות
            </h2>
            <Card className="card-elevated p-4">
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">אין אירועים עדיין — זה סימן טוב.</p>
              ) : (
                events.map((row) => <EventRow key={row.id} row={row} />)
              )}
            </Card>
          </section>
        </>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">בדיקות תשתית חיות (קלות)</h2>
        <p className="text-xs text-muted-foreground">
          DB / API / Storage / Realtime — בדיקות קריאה בלבד מהדף, בנוסף לסריקת החברות/סניפים
          מהשרת.
        </p>
        {liveInfraQuery.isLoading ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">בודק…</Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(liveInfraQuery.data ?? []).map((result) => {
              const meta = STATE_META[result.state] ?? STATE_META.unknown;
              const Icon = meta.icon;
              return (
                <Card key={result.id} className="card-elevated p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{result.target}</span>
                    <div
                      className={`size-8 shrink-0 rounded-lg flex items-center justify-center ${meta.className}`}
                    >
                      <Icon className="size-4" />
                    </div>
                  </div>
                  <Badge variant="outline" className={meta.className.replace("bg-", "border-")}>
                    {meta.label}
                  </Badge>
                  {result.message && (
                    <p className="text-[11px] text-muted-foreground break-words" dir="auto">
                      {result.message}
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
