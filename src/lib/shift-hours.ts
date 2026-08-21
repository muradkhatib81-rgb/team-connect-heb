import { utcDowFromSaturday, type ScheduleDow } from "@/lib/schedule-period-config";

export type ShiftDayHoursRow = {
  shift_definition_id: string;
  day_of_week: number;
  start_time: string | null;
  end_time: string | null;
};

export type ShiftDefLike = {
  id: string;
  start_time?: string | null;
  end_time?: string | null;
};

export function formatShiftTimeRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string | null {
  const s = start ? String(start).trim().slice(0, 5) : null;
  const e = end ? String(end).trim().slice(0, 5) : null;
  if (!s && !e) return null;
  if (s && e) return `${s}–${e}`;
  return s ?? e;
}

export function buildDayHoursIndex(rows: ShiftDayHoursRow[]): Map<string, Map<number, ShiftDayHoursRow>> {
  const index = new Map<string, Map<number, ShiftDayHoursRow>>();
  for (const row of rows) {
    if (!index.has(row.shift_definition_id)) index.set(row.shift_definition_id, new Map());
    index.get(row.shift_definition_id)!.set(row.day_of_week, row);
  }
  return index;
}

/** Resolves display/save defaults: per-day hours when present, else flat definition times. */
export function resolveShiftDefinitionTimes(args: {
  def: ShiftDefLike | null | undefined;
  shiftCode: string | null | undefined;
  dayDate: string;
  dayHoursIndex: Map<string, Map<number, ShiftDayHoursRow>>;
}): { start_time: string | null; end_time: string | null } {
  const def = args.def;
  if (!def || !args.shiftCode || args.shiftCode === "off") {
    return { start_time: null, end_time: null };
  }

  const dow = utcDowFromSaturday(args.dayDate) as ScheduleDow;
  const dayRow = args.dayHoursIndex.get(def.id)?.get(dow);
  if (dayRow) {
    return {
      start_time: dayRow.start_time ?? def.start_time ?? null,
      // Explicit null end on a day row means "no end time" — do not fall back to flat def.
      end_time: dayRow.end_time ?? null,
    };
  }
  return {
    start_time: def.start_time ?? null,
    end_time: def.end_time ?? null,
  };
}

export function emptyDayHoursForShift(
  flatStart: string | null,
  flatEnd: string | null,
  periodDows: ScheduleDow[] = [0, 1, 2, 3, 4, 5, 6],
): Array<{ day_of_week: ScheduleDow; start_time: string | null; end_time: string | null }> {
  return periodDows.map((day_of_week) => ({
    day_of_week,
    start_time: flatStart,
    end_time: flatEnd,
  }));
}
