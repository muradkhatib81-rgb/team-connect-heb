/** Published schedule history: only the dept's most recently published row is "current". */

export type PublishedScheduleRow = {
  id: string;
  department_id: string;
  week_start: string;
  status: string;
  published_at: string | null;
};

/** Latest published schedule for a department (any period/week). */
export async function getLatestPublishedScheduleIdForDepartment(
  supabase: { from: (table: string) => any },
  departmentId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("schedules")
    .select("id")
    .eq("department_id", departmentId)
    .eq("status", "approved")
    .not("published_at", "is", null)
    .order("published_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data?.id as string | undefined) ?? null;
}

export function isSupersededPublishedSchedule(
  schedule: Pick<PublishedScheduleRow, "id" | "status" | "published_at">,
  latestPublishedId: string | null,
): boolean {
  if (schedule.status !== "approved" || !schedule.published_at) return false;
  if (!latestPublishedId) return false;
  return schedule.id !== latestPublishedId;
}

export async function enforceSupersededPublishedSchedulePolicy(
  supabase: { from: (table: string) => any },
  schedule: PublishedScheduleRow,
  caps: { isMainAdmin: boolean },
  action: "edit" | "delete",
): Promise<void> {
  const latestId = await getLatestPublishedScheduleIdForDepartment(
    supabase,
    schedule.department_id,
  );
  if (!isSupersededPublishedSchedule(schedule, latestId)) return;

  if (action === "delete") {
    if (!caps.isMainAdmin) {
      throw new Error("אין הרשאה למחוק סידור עבודה ישן — רק בעל המערכת");
    }
    return;
  }
  throw new Error("לא ניתן לערוך סידור עבודה ישן — צפייה בלבד");
}

/** Build dept → latest published schedule id from a published rows list. */
export function latestPublishedIdByDepartment<
  T extends { id: string; department_id: string; published_at?: string | null },
>(rows: T[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const row of rows) {
    if (!row.published_at) continue;
    const curId = m.get(row.department_id);
    if (!curId) {
      m.set(row.department_id, row.id);
      continue;
    }
    const cur = rows.find((r) => r.id === curId);
    if ((row.published_at ?? "") > (cur?.published_at ?? "")) {
      m.set(row.department_id, row.id);
    }
  }
  return m;
}

export function isDeptWideLatestPublished<
  T extends { id: string; department_id: string; published_at?: string | null },
>(item: T, latestByDept: Map<string, string>): boolean {
  return latestByDept.get(item.department_id) === item.id;
}
