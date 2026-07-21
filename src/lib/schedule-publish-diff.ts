/** Helpers for comparing live schedule cells against the published snapshot. */

export function normScheduleTimeHm(value: string | null | undefined): string | null {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return null;
}

export type PublishedCellTimes = {
  start: string | null;
  end: string | null;
};

export function isScheduleShiftModified(args: {
  currentShift: string | null | undefined;
  publishedShift: string | null;
}): boolean {
  return (args.currentShift ?? null) !== (args.publishedShift ?? null);
}

export function isScheduleCellModified(args: {
  currentShift: string | null | undefined;
  publishedShift: string | null;
  currentStart: string | null;
  currentEnd: string | null;
  publishedTimes?: PublishedCellTimes;
  publishedShiftDefaults?: { start_time?: string | null; end_time?: string | null } | null;
}): boolean {
  if (isScheduleShiftModified(args)) return true;
  const cur = args.currentShift ?? null;
  if (!cur || cur === "off") return false;

  const pubStart =
    normScheduleTimeHm(args.publishedTimes?.start) ??
    normScheduleTimeHm(args.publishedShiftDefaults?.start_time);
  const pubEnd =
    normScheduleTimeHm(args.publishedTimes?.end) ??
    normScheduleTimeHm(args.publishedShiftDefaults?.end_time);
  const curStart = normScheduleTimeHm(args.currentStart);
  const curEnd = normScheduleTimeHm(args.currentEnd);
  return curStart !== pubStart || curEnd !== pubEnd;
}

export type PublishedCellBaseline = PublishedCellTimes & { shift: string | null };

/** Build frozen baseline for change markers (published shift + effective times at open). */
export function buildPublishedBaselineFromShifts(
  rows: {
    employee_id: string;
    day_date: string;
    published_shift?: string | null;
    start_time?: string | null;
    end_time?: string | null;
  }[],
  shiftDefs?: Map<string, { start_time?: string | null; end_time?: string | null }>,
): Record<string, PublishedCellBaseline> {
  const m: Record<string, PublishedCellBaseline> = {};
  for (const s of rows) {
    const pubShift = s.published_shift ?? null;
    const pubDef = pubShift ? shiftDefs?.get(pubShift) : undefined;
    m[`${s.employee_id}|${s.day_date}`] = {
      shift: pubShift,
      start:
        normScheduleTimeHm(s.start_time) ?? normScheduleTimeHm(pubDef?.start_time),
      end: normScheduleTimeHm(s.end_time) ?? normScheduleTimeHm(pubDef?.end_time),
    };
  }
  return m;
}

export function isScheduleTimeModified(args: {
  currentStart: string | null;
  currentEnd: string | null;
  publishedTimes?: PublishedCellTimes;
}): boolean {
  const pubStart = normScheduleTimeHm(args.publishedTimes?.start);
  const pubEnd = normScheduleTimeHm(args.publishedTimes?.end);
  const curStart = normScheduleTimeHm(args.currentStart);
  const curEnd = normScheduleTimeHm(args.currentEnd);
  return curStart !== pubStart || curEnd !== pubEnd;
}
