import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { retainSharedRealtimeChannel } from "@/lib/realtime-shared-channel";

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

/** Live list of shift definitions. Pass {activeOnly:true} to filter. */
export function useShiftDefinitions(opts: { activeOnly?: boolean } = {}) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["shift-definitions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shift_definitions")
        .select("id, code, name, start_time, end_time, color, sort_order, is_active, is_system")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ShiftDef[];
    },
    staleTime: 30_000,
  });

  useEffect(() => {
    return retainSharedRealtimeChannel("shift-definitions-rt", (channel) =>
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shift_definitions" },
        () => qc.invalidateQueries({ queryKey: ["shift-definitions"] }),
      ),
    );
  }, [qc]);

  const all = query.data ?? [];
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
  return { ...query, list, all, map, label, color };
}
