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

export function isScheduleCellModified(args: {
  currentShift: string | null | undefined;
  publishedShift: string | null;
  currentStart: string | null;
  currentEnd: string | null;
  publishedTimes?: PublishedCellTimes;
  publishedShiftDefaults?: { start_time?: string | null; end_time?: string | null } | null;
}): boolean {
  const cur = args.currentShift ?? null;
  const pub = args.publishedShift ?? null;
  if (cur !== pub) return true;
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
