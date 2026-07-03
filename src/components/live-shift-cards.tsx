import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useShiftDefinitions } from "@/lib/use-shift-definitions";
import {
  formatHHMM,
  isWithinShiftWindow,
  parseHHMMToMinutes,
  usePlatformNow,
} from "@/lib/platform-time";

type TodayRow = {
  employee_id: string;
  shift: string;
  start_time: string | null;
  end_time: string | null;
  schedule_id: string;
};

type EmployeeInfo = {
  id: string;
  full_name: string;
  job_title: string | null;
};

type DisplayEmployee = EmployeeInfo & { start: string | null; end: string | null };

/**
 * Dynamic real-time shift cards for the Main Dashboard.
 *
 * - One card per active shift definition (ordered by sort_order).
 * - Cards remain visible even when the count is zero; they only disappear
 *   when the shift definition itself is deactivated or deleted.
 * - Counts are the employees whose today's assignment falls within the
 *   effective `[start, end]` window in the platform time zone.
 * - Realtime subscriptions on `schedule_shifts`, `schedules`, and
 *   `shift_definitions` scoped invalidations keep the cards live without
 *   polling and without reloads.
 */
export function LiveShiftCardsSection() {
  const qc = useQueryClient();
  const shiftDefsQ = useShiftDefinitions({ activeOnly: true });
  const { dateISO, minutesOfDay } = usePlatformNow(
    // Boundary set = every distinct start/end used today (definition defaults +
    // per-row overrides). Computed inside the ticker after data loads via key
    // — falling back to the safety 60s tick until then is fine.
    shiftDefsQ.list.flatMap((s) => [
      s.start_time ? String(s.start_time).slice(0, 5) : null,
      s.end_time ? String(s.end_time).slice(0, 5) : null,
    ]),
  );

  // Today's published assignments (RLS auto-scopes to the active branch).
  const rowsQ = useQuery<TodayRow[]>({
    queryKey: ["dashboard-shift-cards", "today", dateISO],
    queryFn: async () => {
      const { data: scheds } = await supabase
        .from("schedules")
        .select("id")
        .eq("status", "approved")
        .not("published_at", "is", null);
      const ids = (scheds ?? []).map((s: any) => s.id as string);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("schedule_shifts")
        .select("employee_id, shift, start_time, end_time, schedule_id")
        .eq("day_date", dateISO)
        .in("schedule_id", ids);
      if (error) throw error;
      return (data ?? []) as TodayRow[];
    },
    staleTime: 30_000,
  });

  const empIds = useMemo(
    () => Array.from(new Set((rowsQ.data ?? []).map((r) => r.employee_id))),
    [rowsQ.data],
  );

  const empsQ = useQuery<EmployeeInfo[]>({
    enabled: empIds.length > 0,
    queryKey: ["dashboard-shift-cards", "emps", empIds.sort().join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, job_title")
        .in("id", empIds);
      if (error) throw error;
      return (data ?? []) as EmployeeInfo[];
    },
    staleTime: 60_000,
  });

  // Realtime: keep the dashboard live without polling.
  useEffect(() => {
    const ch = supabase
      .channel("dashboard-shift-cards")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_shifts" },
        () => qc.invalidateQueries({ queryKey: ["dashboard-shift-cards", "today"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedules" },
        () => qc.invalidateQueries({ queryKey: ["dashboard-shift-cards", "today"] }),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_definitions" },
        () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [qc]);

  // Group employees by shift code, filtered by the live window.
  const { byShift, empMap } = useMemo(() => {
    const empMap = new Map<string, EmployeeInfo>();
    for (const e of empsQ.data ?? []) empMap.set(e.id, e);
    const byShift = new Map<string, DisplayEmployee[]>();
    for (const def of shiftDefsQ.list) byShift.set(def.code, []);
    for (const r of rowsQ.data ?? []) {
      const def = shiftDefsQ.map.get(r.shift);
      if (!def || !def.is_active) continue;
      const start = r.start_time ?? def.start_time ?? null;
      const end = r.end_time ?? def.end_time ?? null;
      const startMin = parseHHMMToMinutes(start);
      const endMin = parseHHMMToMinutes(end);
      if (startMin == null || endMin == null) continue;
      if (!isWithinShiftWindow(startMin, endMin, minutesOfDay)) continue;
      const info = empMap.get(r.employee_id);
      const list = byShift.get(r.shift) ?? [];
      list.push({
        id: r.employee_id,
        full_name: info?.full_name ?? "עובד",
        job_title: info?.job_title ?? null,
        start: formatHHMM(start),
        end: formatHHMM(end),
      });
      byShift.set(r.shift, list);
    }
    for (const list of byShift.values()) {
      list.sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
    }
    return { byShift, empMap };
  }, [rowsQ.data, empsQ.data, shiftDefsQ.list, shiftDefsQ.map, minutesOfDay]);

  void empMap;

  const [openShift, setOpenShift] = useState<string | null>(null);

  if (shiftDefsQ.list.length === 0) return null;

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">משמרות פעילות עכשיו</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {shiftDefsQ.list.map((def) => {
          const list = byShift.get(def.code) ?? [];
          const count = list.length;
          const countLabel =
            count === 0 ? "0 עובדים" : count === 1 ? "עובד אחד" : `${count} עובדים`;
          const defaultRange =
            def.start_time && def.end_time
              ? `${String(def.start_time).slice(0, 5)}–${String(def.end_time).slice(0, 5)}`
              : "";
          return (
            <ShiftCard
              key={def.id}
              name={def.name}
              color={def.color}
              count={count}
              countLabel={countLabel}
              defaultRange={defaultRange}
              onOpen={() => setOpenShift(def.code)}
            />
          );
        })}
      </div>

      <Dialog open={!!openShift} onOpenChange={(o) => !o && setOpenShift(null)}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>
              {openShift ? shiftDefsQ.map.get(openShift)?.name ?? "משמרת" : "משמרת"}
            </DialogTitle>
          </DialogHeader>
          {(() => {
            const list = openShift ? byShift.get(openShift) ?? [] : [];
            if (list.length === 0) {
              return (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  אין עובדים במשמרת זו כרגע
                </p>
              );
            }
            return (
              <ul className="divide-y max-h-[60vh] overflow-y-auto">
                {list.map((e) => (
                  <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{e.full_name}</div>
                      {e.job_title && (
                        <div className="text-xs text-muted-foreground truncate">
                          {e.job_title}
                        </div>
                      )}
                    </div>
                    {e.start && e.end && (
                      <div className="text-xs tabular-nums text-muted-foreground" dir="ltr">
                        {e.start}–{e.end}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            );
          })()}
        </DialogContent>
      </Dialog>
    </section>
  );
}

const ShiftCard = ({
  name,
  color,
  count,
  countLabel,
  defaultRange,
  onOpen,
}: {
  name: string;
  color: string;
  count: number;
  countLabel: string;
  defaultRange: string;
  onOpen: () => void;
}) => {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="text-right rounded-xl border bg-card p-4 hover:shadow-md hover:-translate-y-0.5 transition focus:outline-none focus:ring-2 focus:ring-ring"
      aria-label={`${name}: ${countLabel}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="font-semibold truncate">{name}</span>
          </div>
          {defaultRange && (
            <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums" dir="ltr">
              {defaultRange}
            </div>
          )}
        </div>
        <Users className="size-4 text-muted-foreground shrink-0" />
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="text-3xl font-bold tabular-nums" style={{ color }}>
          {count}
        </span>
        <span className="text-xs text-muted-foreground">{countLabel}</span>
      </div>
    </button>
  );
};
