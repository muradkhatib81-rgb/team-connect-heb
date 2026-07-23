/** Helpers for comparing live schedule cells against submitted / published baselines. */

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

export type PublishedCellBaseline = PublishedCellTimes & {
  shift: string | null;
  note: string | null;
};

export type ScheduleShiftSnapshotRow = {
  employee_id: string;
  day_date: string;
  shift?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  note?: string | null;
  published_shift?: string | null;
  published_start_time?: string | null;
  published_end_time?: string | null;
  published_note?: string | null;
  submitted_shift?: string | null;
  submitted_start_time?: string | null;
  submitted_end_time?: string | null;
  submitted_note?: string | null;
};

export type ScheduleChangeBaselineKind = "submitted" | "published" | null;

export function resolveScheduleChangeBaselineKind(schedule: {
  status: string;
  published_at: string | null;
  submitted_at?: string | null;
}): ScheduleChangeBaselineKind {
  if (schedule.status === "approved" && schedule.published_at) return "published";
  if (
    schedule.submitted_at &&
    (schedule.status === "pending_approval" ||
      (schedule.status === "approved" && !schedule.published_at))
  ) {
    return "submitted";
  }
  return null;
}

export function effectiveCellTimes(args: {
  shift: string | null;
  start_time?: string | null;
  end_time?: string | null;
  shiftDef?: { start_time?: string | null; end_time?: string | null } | null;
}): PublishedCellTimes {
  const shift = args.shift ?? null;
  if (!shift || shift === "off") return { start: null, end: null };
  const def = args.shiftDef;
  return {
    start: normScheduleTimeHm(args.start_time) ?? normScheduleTimeHm(def?.start_time),
    end: normScheduleTimeHm(args.end_time) ?? normScheduleTimeHm(def?.end_time),
  };
}

function baselineFieldsForKind(
  row: ScheduleShiftSnapshotRow,
  kind: "submitted" | "published",
): {
  shift: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
} {
  if (kind === "submitted") {
    return {
      shift: row.submitted_shift ?? null,
      start_time: row.submitted_start_time ?? null,
      end_time: row.submitted_end_time ?? null,
      note: row.submitted_note ?? null,
    };
  }
  return {
    shift: row.published_shift ?? null,
    start_time: row.published_start_time ?? null,
    end_time: row.published_end_time ?? null,
    note: row.published_note ?? null,
  };
}

export function buildChangeBaselineFromShiftRow(
  row: ScheduleShiftSnapshotRow,
  kind: "submitted" | "published",
  shiftDefs?: Map<string, { start_time?: string | null; end_time?: string | null }>,
): PublishedCellBaseline | null {
  const fields = baselineFieldsForKind(row, kind);
  if (fields.shift == null && kind === "submitted") return null;
  if (fields.shift == null && kind === "published") return null;

  const pubDef = fields.shift ? shiftDefs?.get(fields.shift) : undefined;
  const times = effectiveCellTimes({
    shift: fields.shift,
    start_time: fields.start_time,
    end_time: fields.end_time,
    shiftDef: pubDef,
  });

  return {
    shift: fields.shift,
    start: times.start,
    end: times.end,
    note: normScheduleNote(fields.note),
  };
}

export function buildChangeBaselineMap(
  rows: ScheduleShiftSnapshotRow[],
  kind: "submitted" | "published",
  shiftDefs?: Map<string, { start_time?: string | null; end_time?: string | null }>,
): Record<string, PublishedCellBaseline> {
  const m: Record<string, PublishedCellBaseline> = {};
  for (const row of rows) {
    const baseline = buildChangeBaselineFromShiftRow(row, kind, shiftDefs);
    if (!baseline) continue;
    m[`${row.employee_id}|${row.day_date}`] = baseline;
  }
  return m;
}

/** @deprecated Use buildChangeBaselineMap(..., "published") */
export function buildPublishedBaselineFromShifts(
  rows: ScheduleShiftSnapshotRow[],
  shiftDefs?: Map<string, { start_time?: string | null; end_time?: string | null }>,
): Record<string, PublishedCellBaseline> {
  return buildChangeBaselineMap(rows, "published", shiftDefs);
}

export function isScheduleShiftModified(args: {
  currentShift: string | null | undefined;
  publishedShift: string | null;
}): boolean {
  return (args.currentShift ?? null) !== (args.publishedShift ?? null);
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

export function normScheduleNote(value: string | null | undefined): string | null {
  const s = value?.trim().slice(0, 10) ?? "";
  return s.length > 0 ? s : null;
}

export function isScheduleNoteModified(args: {
  currentNote: string | null | undefined;
  publishedNote: string | null | undefined;
}): boolean {
  return normScheduleNote(args.currentNote) !== normScheduleNote(args.publishedNote);
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

export type ScheduleCellChangeFlags = {
  isShiftModified: boolean;
  isTimeModified: boolean;
  isNoteModified: boolean;
  isAnyModified: boolean;
};

export function diffScheduleCellAgainstBaseline(args: {
  currentShift: string | null | undefined;
  currentStart: string | null;
  currentEnd: string | null;
  currentNote: string | null | undefined;
  baseline: PublishedCellBaseline | null | undefined;
  currentShiftDef?: { start_time?: string | null; end_time?: string | null } | null;
}): ScheduleCellChangeFlags {
  const baseline = args.baseline;
  if (!baseline) {
    return {
      isShiftModified: false,
      isTimeModified: false,
      isNoteModified: false,
      isAnyModified: false,
    };
  }

  const curShift = args.currentShift ?? null;
  const isShiftModified = isScheduleShiftModified({
    currentShift: curShift,
    publishedShift: baseline.shift,
  });

  const curTimes = effectiveCellTimes({
    shift: curShift,
    start_time: args.currentStart,
    end_time: args.currentEnd,
    shiftDef: args.currentShiftDef,
  });

  const isTimeModified =
    !!curShift &&
    curShift !== "off" &&
    isScheduleTimeModified({
      currentStart: curTimes.start,
      currentEnd: curTimes.end,
      publishedTimes: { start: baseline.start, end: baseline.end },
    });

  const isNoteModified = isScheduleNoteModified({
    currentNote: args.currentNote,
    publishedNote: baseline.note,
  });

  return {
    isShiftModified,
    isTimeModified,
    isNoteModified,
    isAnyModified: isShiftModified || isTimeModified || isNoteModified,
  };
}

/** Managers / dept heads also see cells changed during approval vs the submitted snapshot. */
export function diffScheduleCellForViewer(args: {
  currentShift: string | null | undefined;
  currentStart: string | null;
  currentEnd: string | null;
  currentNote: string | null | undefined;
  baselineKind: ScheduleChangeBaselineKind;
  submittedBaseline?: PublishedCellBaseline | null;
  publishedBaseline?: PublishedCellBaseline | null;
  currentShiftDef?: { start_time?: string | null; end_time?: string | null } | null;
  includeSubmittedDiffWhenPublished: boolean;
}): ScheduleCellChangeFlags {
  const cellArgs = {
    currentShift: args.currentShift,
    currentStart: args.currentStart,
    currentEnd: args.currentEnd,
    currentNote: args.currentNote,
    currentShiftDef: args.currentShiftDef,
  };

  if (args.baselineKind === "published") {
    const publishedDiff = diffScheduleCellAgainstBaseline({
      ...cellArgs,
      baseline: args.publishedBaseline,
    });
    if (publishedDiff.isAnyModified) return publishedDiff;
    if (args.includeSubmittedDiffWhenPublished) {
      return diffScheduleCellAgainstBaseline({
        ...cellArgs,
        baseline: args.submittedBaseline,
      });
    }
    return publishedDiff;
  }

  if (args.baselineKind === "submitted") {
    return diffScheduleCellAgainstBaseline({
      ...cellArgs,
      baseline: args.submittedBaseline,
    });
  }

  return {
    isShiftModified: false,
    isTimeModified: false,
    isNoteModified: false,
    isAnyModified: false,
  };
}
