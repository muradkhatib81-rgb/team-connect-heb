/** Group schedule rows by their saved period (week_start → week_end), future-proof for longer ranges. */

export type SchedulePeriodRow = {
  week_start: string;
  week_end: string;
};

export function schedulePeriodKey(row: SchedulePeriodRow): string {
  return `${row.week_start}|${row.week_end}`;
}

export type SchedulePeriodGroup<T extends SchedulePeriodRow> = {
  periodKey: string;
  week_start: string;
  week_end: string;
  items: T[];
};

export function groupSchedulesByPeriod<T extends SchedulePeriodRow>(
  rows: T[],
): SchedulePeriodGroup<T>[] {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = schedulePeriodKey(row);
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return [...map.entries()]
    .map(([periodKey, items]) => ({
      periodKey,
      week_start: items[0]!.week_start,
      week_end: items[0]!.week_end,
      items,
    }))
    .sort((a, b) => b.week_start.localeCompare(a.week_start));
}

/** Keep only the N most recent rows per department (e.g. latest published + previous). */
export function limitLatestPerDepartment<
  T extends SchedulePeriodRow & { department_id: string },
>(
  rows: T[],
  maxPerDepartment: number,
  recencyOf: (row: T) => string | null | undefined,
): T[] {
  const byDept = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = byDept.get(row.department_id);
    if (bucket) bucket.push(row);
    else byDept.set(row.department_id, [row]);
  }
  const result: T[] = [];
  for (const deptRows of byDept.values()) {
    deptRows.sort((a, b) => {
      const ta = recencyOf(a) ?? "";
      const tb = recencyOf(b) ?? "";
      return tb.localeCompare(ta);
    });
    result.push(...deptRows.slice(0, maxPerDepartment));
  }
  return result.sort((a, b) => {
    const ta = recencyOf(a) ?? "";
    const tb = recencyOf(b) ?? "";
    return tb.localeCompare(ta);
  });
}

export function groupSchedulesByPeriodLimitedPerDept<
  T extends SchedulePeriodRow & { department_id: string },
>(
  rows: T[],
  maxPerDepartment: number,
  recencyOf: (row: T) => string | null | undefined,
): SchedulePeriodGroup<T>[] {
  return groupSchedulesByPeriod(rows)
    .map((group) => ({
      ...group,
      items: limitLatestPerDepartment(group.items, maxPerDepartment, recencyOf),
    }))
    .filter((group) => group.items.length > 0);
}
