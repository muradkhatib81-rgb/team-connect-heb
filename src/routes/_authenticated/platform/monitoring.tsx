import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  RefreshCcw,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { usePlatformContext } from "@/platform";
import type { HealthState, HealthTarget } from "@/core/monitoring/types";

export const Route = createFileRoute("/_authenticated/platform/monitoring")({
  component: PlatformMonitoringPage,
});

const TARGET_LABELS: Record<HealthTarget, string> = {
  platform: "פלטפורמה",
  company: "חברה",
  branch: "סניף",
  department: "מחלקה",
  database: "מסד נתונים",
  storage: "אחסון",
  realtime: "Real-Time",
  api: "API",
  queue: "תור עבודות",
  sync: "סנכרון",
  configuration: "תצורה",
  managers: "מנהלי מערכת (Managers)",
};

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
    label: "מוגבל",
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

function PlatformMonitoringPage() {
  const { runtime } = usePlatformContext();

  const healthQuery = useQuery({
    queryKey: ["platform-monitoring", "health"],
    queryFn: () => runtime.getGlobalMonitoring(),
    refetchInterval: 30_000,
  });

  const results = healthQuery.data ?? [];
  const healthyCount = results.filter((r) => r.state === "healthy").length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="size-11 shrink-0 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <Activity className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-2xl sm:text-3xl font-bold">ניטור פלטפורמה וזמינות</h1>
            <p className="text-sm text-muted-foreground mt-1">
              בדיקות זמינות (Health Checks) בזמן אמת, לכל רכיבי הפלטפורמה — דרך ה-Monitoring Manager
              הקיים
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => healthQuery.refetch()}
          disabled={healthQuery.isFetching}
        >
          <RefreshCcw className={`size-4 ${healthQuery.isFetching ? "animate-spin" : ""}`} />
          רענון
        </Button>
      </header>

      <Card className="card-elevated p-4 flex items-center gap-3">
        <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400">
          {healthyCount} / {results.length} תקינים
        </Badge>
        <p className="text-xs text-muted-foreground">
          מרענן אוטומטית כל 30 שניות. הבדיקות לקריאה בלבד (DB / Storage / Realtime / API) — ללא שינוי
          נתונים או הרשאות. רכיבים שאינם מחוברים (למשל תור עבודות) מוצגים כ"לא ידוע".
        </p>
      </Card>

      {healthQuery.isLoading ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">בודק זמינות…</Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {results.map((result) => {
            const meta = STATE_META[result.state];
            const Icon = meta.icon;
            return (
              <Card key={result.id} className="card-elevated p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    {TARGET_LABELS[result.target] ?? result.target}
                  </span>
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
                <p className="text-[11px] text-muted-foreground">
                  נבדק: {result.checkedAt.toLocaleTimeString("he-IL")}
                </p>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
