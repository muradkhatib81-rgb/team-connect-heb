import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { retainSharedRealtimeChannel } from "@/lib/realtime-shared-channel";
import {
  buildDayHoursIndex,
  resolveShiftDefinitionTimes,
  type ShiftDayHoursRow,
} from "@/lib/shift-hours";

export type ShiftDef = {
  id: string;
  code: string;
  name: string;
  start_time: string | null;
  end_time: string | null;
  color: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
};

export type ShiftDefDayHours = ShiftDayHoursRow;

/** Live list of shift definitions. Pass {activeOnly:true} to filter. */
export function useShiftDefinitions(opts: { activeOnly?: boolean } = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["shift-definitions"],
    queryFn: async () => {
      const [defsRes, hoursRes] = await Promise.all([
        supabase
          .from("shift_definitions")
          .select("id, code, name, start_time, end_time, color, sort_order, is_active, is_system")
          .order("sort_order", { ascending: true }),
        supabase
          .from("shift_definition_day_hours" as any)
          .select("shift_definition_id, day_of_week, start_time, end_time"),
      ]);
      if (defsRes.error) throw defsRes.error;
      const dayHours = hoursRes.error ? [] : ((hoursRes.data ?? []) as ShiftDayHoursRow[]);
      return {
        defs: (defsRes.data ?? []) as ShiftDef[],
        dayHours,
      };
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    return retainSharedRealtimeChannel("shift-definitions-rt", (channel) =>
      channel
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shift_definitions" },
          () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "shift_definition_day_hours" },
          () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
        ),
    );
  }, [qc]);

  const all = query.data?.defs ?? [];
  const dayHours = query.data?.dayHours ?? [];
  const dayHoursIndex = useMemo(() => buildDayHoursIndex(dayHours), [dayHours]);

  const list = useMemo(
    () => (opts.activeOnly ? all.filter((s) => s.is_active) : all),
    [all, opts.activeOnly],
  );
  const map = useMemo(
    () => new Map(all.map((s) => [s.code, s] as const)),
    [all],
  );
  const label = useMemo(
    () =>
      (code: string | null | undefined, fallback = "—") => {
        if (!code) return fallback;
        return map.get(code)?.name ?? code;
      },
    [map],
  );
  const color = useMemo(
    () => (code: string | null | undefined) => {
      if (!code) return undefined;
      return map.get(code)?.color;
    },
    [map],
  );

  const getTimesForDay = useCallback(
    (code: string | null | undefined, dayDate: string) => {
      const def = code ? map.get(code) : undefined;
      return resolveShiftDefinitionTimes({
        def,
        shiftCode: code,
        dayDate,
        dayHoursIndex,
      });
    },
    [map, dayHoursIndex],
  );

  const dayHoursForShift = useCallback(
    (shiftId: string) => {
      const byDay = dayHoursIndex.get(shiftId);
      if (!byDay) return [];
      return Array.from(byDay.values()).sort((a, b) => a.day_of_week - b.day_of_week);
    },
    [dayHoursIndex],
  );

  return {
    ...query,
    list,
    all,
    map,
    label,
    color,
    dayHours,
    dayHoursIndex,
    getTimesForDay,
    dayHoursForShift,
  };
}
