import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, ChevronDown, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DailyScheduleOverview,
  type DailyScheduleScope,
} from "@/components/daily-schedule-overview";
import { getDashboardPublishedPeriods } from "@/lib/schedules.functions";
import { formatScheduleDayHe } from "@/lib/schedule-week";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";

export type DailySchedulePeriodCardsProps = {
  scope: DailyScheduleScope;
  departmentId?: string | null;
  selfUserId?: string;
  useCoworkersView?: boolean;
  onSelectedDayChange?: (day: string) => void;
};

export function DailySchedulePeriodCards({
  scope,
  departmentId,
  selfUserId,
  useCoworkersView = false,
  onSelectedDayChange,
}: DailySchedulePeriodCardsProps) {
  const getPeriodsFn = useServerFn(getDashboardPublishedPeriods);
  const [expandedWeekStart, setExpandedWeekStart] = useState<string | null>(null);

  const q = useQuery({
    queryKey: [
      "dashboard-published-periods",
      scope,
      departmentId ?? "all",
      useCoworkersView,
    ] as const,
    queryFn: () =>
      getPeriodsFn({
        data: {
          scope,
          department_id: departmentId ?? undefined,
          use_coworkers_view: useCoworkersView,
        },
      }),
    enabled: scope === "branch" || !!departmentId,
    staleTime: 30_000,
  });

  const periods = q.data?.periods ?? [];

  if (q.isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  if (q.isError) {
    return (
      <p className="text-sm text-destructive text-center py-4">
        {(q.error as Error)?.message ?? i18n.t("dashboard.scheduleLoadError")}
      </p>
    );
  }

  if (!periods.length) {
    return (
      <Card className="card-elevated p-6">
        <p className="text-sm text-muted-foreground text-center">
          {i18n.t("dashboard.noApprovedPublishedWeek")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {periods.map((period) => {
        const isOpen = expandedWeekStart === period.weekStart;
        const rangeLabel = `${formatScheduleDayHe(period.periodStart)} – ${formatScheduleDayHe(period.periodEnd)}`;

        return (
          <Collapsible
            key={period.weekStart}
            open={isOpen}
            onOpenChange={(open) => {
              setExpandedWeekStart(open ? period.weekStart : null);
            }}
          >
            <Card className="card-elevated overflow-hidden">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2.5 p-3 text-right outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <CalendarDays className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold leading-tight tabular-nums">
                      {rangeLabel}
                    </h3>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {i18n.t("dashboard.dailySchedule")}
                    </p>
                  </div>
                  <ChevronDown
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground transition-transform",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>
              </CollapsibleTrigger>

              <CollapsibleContent>
                {isOpen ? (
                  <div className="border-t">
                    <DailyScheduleOverview
                      scope={scope}
                      departmentId={departmentId}
                      selfUserId={selfUserId}
                      useCoworkersView={useCoworkersView}
                      weekStart={period.weekStart}
                      embedded
                      showFullScheduleLink={false}
                      reportDayChanges
                      onSelectedDayChange={onSelectedDayChange}
                    />
                  </div>
                ) : null}
              </CollapsibleContent>
            </Card>
          </Collapsible>
        );
      })}
    </div>
  );
}
