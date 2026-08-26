/**
 * بصمة الدوام / Attendance punch — isolated feature.
 * Does NOT read/write user_roles or user_task_permissions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unauthorized");
}

async function resolveOperationalBranchId(scopeId: string): Promise<string> {
  const { data: branch } = await supabaseAdmin
    .from("branches")
    .select("id")
    .eq("id", scopeId)
    .maybeSingle();
  if (branch?.id) return branch.id as string;

  const { data: assignment } = await (supabaseAdmin as any)
    .from("company_branch_assignments")
    .select("source_branch_id")
    .eq("id", scopeId)
    .is("deleted_at", null)
    .maybeSingle();
  if (assignment?.source_branch_id) return assignment.source_branch_id as string;

  throw new Error("Branch not found");
}

export type AttendanceCapabilities = {
  enabled: boolean;
  can_punch: boolean;
  can_view: boolean;
  can_edit: boolean;
  can_delete: boolean;
  is_platform_owner: boolean;
  show_employee_card: boolean;
  show_manager_card: boolean;
  hide_reason?: string | null;
};

export type AttendanceSession = {
  id: string;
  user_id: string;
  branch_id: string;
  department_id: string | null;
  clock_in_at: string;
  clock_out_at: string | null;
  year_month: string;
  source: string;
  note: string | null;
  duration_minutes?: number | null;
  employee_name?: string | null;
  id_number?: string | null;
  department_name?: string | null;
};

const emptyCaps = (): AttendanceCapabilities => ({
  enabled: false,
  can_punch: false,
  can_view: false,
  can_edit: false,
  can_delete: false,
  is_platform_owner: false,
  show_employee_card: false,
  show_manager_card: false,
  hide_reason: null,
});

function mapCaps(c: Record<string, unknown> | null | undefined): AttendanceCapabilities {
  if (!c) return emptyCaps();
  return {
    enabled: !!c.enabled,
    can_punch: !!c.can_punch,
    can_view: !!c.can_view,
    can_edit: !!c.can_edit,
    can_delete: !!c.can_delete,
    is_platform_owner: !!c.is_platform_owner,
    show_employee_card: !!c.show_employee_card,
    show_manager_card: !!c.show_manager_card,
    hide_reason: c.hide_reason != null ? String(c.hide_reason) : null,
  };
}

function durationMinutes(clockIn: string, clockOut: string | null): number | null {
  if (!clockOut) return null;
  const ms = new Date(clockOut).getTime() - new Date(clockIn).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.ceil(ms / 60000);
}

export const getAttendanceCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<AttendanceCapabilities> => {
    const { supabase } = context as { supabase: any };
    const { data: caps, error } = await supabase.rpc("get_attendance_my_capabilities", {
      _branch_id: data.branchId,
    });
    if (error) {
      if (/does not exist|function/i.test(error.message)) return emptyCaps();
      throw new Error(error.message);
    }
    return mapCaps(caps as Record<string, unknown>);
  });

export const listAttendanceFeatureScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { data, error } = await supabase
      .from("attendance_feature_scopes")
      .select("id, company_id, branch_id, enabled, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return data ?? [];
  });

export const upsertAttendanceFeatureScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      scopeType: z.enum(["company", "branch"]),
      scopeId: z.string().uuid(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const branchId =
      data.scopeType === "branch" ? await resolveOperationalBranchId(data.scopeId) : null;
    const row =
      data.scopeType === "company"
        ? { company_id: data.scopeId, branch_id: null, enabled: data.enabled, granted_by: userId }
        : { company_id: null, branch_id: branchId, enabled: data.enabled, granted_by: userId };

    if (data.scopeType === "company") {
      await supabase.from("attendance_feature_scopes").delete().eq("company_id", data.scopeId);
    } else {
      await supabase.from("attendance_feature_scopes").delete().eq("branch_id", branchId);
    }
    const { error: insErr } = await supabase.from("attendance_feature_scopes").insert(row);
    if (insErr) throw new Error(insErr.message);
    return { ok: true };
  });

export const deleteAttendanceFeatureScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { error } = await supabase.from("attendance_feature_scopes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listAttendanceUserGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid().optional() }).optional())
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    let q = supabase
      .from("attendance_user_grants")
      .select("id, user_id, branch_id, can_view, can_edit, can_delete, created_at")
      .order("created_at", { ascending: false });
    if (data?.branchId) q = q.eq("branch_id", data.branchId);
    const { data: rows, error } = await q;
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const list = rows ?? [];
    const ids = [...new Set(list.map((r: any) => r.user_id))];
    if (ids.length === 0) return [];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, id_number")
      .in("id", ids);
    const byId = new Map((profiles ?? []).map((p: any) => [p.id, p]));
    return list.map((r: any) => ({
      ...r,
      full_name: byId.get(r.user_id)?.full_name ?? null,
      id_number: byId.get(r.user_id)?.id_number ?? null,
    }));
  });

export const upsertAttendanceUserGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string().uuid(),
      branchId: z.string().uuid(),
      can_view: z.boolean(),
      can_edit: z.boolean(),
      can_delete: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const branchId = await resolveOperationalBranchId(data.branchId);
    if (!data.can_view && !data.can_edit && !data.can_delete) {
      const { error } = await supabase
        .from("attendance_user_grants")
        .delete()
        .eq("user_id", data.userId)
        .eq("branch_id", branchId);
      if (error) throw new Error(error.message);
      return { ok: true, removed: true };
    }
    const { error } = await supabase.from("attendance_user_grants").upsert(
      {
        user_id: data.userId,
        branch_id: branchId,
        can_view: data.can_view,
        can_edit: data.can_edit,
        can_delete: data.can_delete,
        granted_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,branch_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listBranchProfilesForAttendanceGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const branchId = await resolveOperationalBranchId(data.branchId);
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, full_name, id_number, department_id")
      .eq("branch_id", branchId)
      .order("full_name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listAttendanceJobTitlePunchSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { data, error } = await supabase
      .from("job_titles")
      .select("id, name, can_punch_attendance, sort_order")
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (error) {
      if (/does not exist|column/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return data ?? [];
  });

export const setAttendanceJobTitlePunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      jobTitleId: z.string().uuid(),
      can_punch_attendance: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { error } = await supabaseAdmin
      .from("job_titles")
      .update({ can_punch_attendance: data.can_punch_attendance })
      .eq("id", data.jobTitleId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateBranchAttendanceGeo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      geo_lat: z.number().min(-90).max(90),
      geo_lng: z.number().min(-180).max(180),
      geo_radius_m: z.number().int().min(20).max(2000).default(100),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const branchId = await resolveOperationalBranchId(data.branchId);
    const { error } = await supabase
      .from("branches")
      .update({
        geo_lat: data.geo_lat,
        geo_lng: data.geo_lng,
        geo_radius_m: data.geo_radius_m,
      })
      .eq("id", branchId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getBranchAttendanceGeo = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const branchId = await resolveOperationalBranchId(data.branchId);
    const { data: row, error } = await supabase
      .from("branches")
      .select("id, name, geo_lat, geo_lng, geo_radius_m")
      .eq("id", branchId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

export const attendancePunch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      kind: z.enum(["in", "out"]),
      lat: z.number(),
      lng: z.number(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: result, error } = await supabase.rpc("attendance_punch", {
      _branch_id: data.branchId,
      _kind: data.kind,
      _lat: data.lat,
      _lng: data.lng,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const getMyAttendanceMonth = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const caps = await supabase.rpc("get_attendance_my_capabilities", {
      _branch_id: data.branchId,
    });
    if (caps.error && !/does not exist|function/i.test(caps.error.message)) {
      throw new Error(caps.error.message);
    }
    const mapped = mapCaps(caps.data as Record<string, unknown>);
    if (!mapped.enabled) {
      return { sessions: [] as AttendanceSession[], total_minutes: 0, open: null as AttendanceSession | null };
    }

    const { data: rows, error } = await supabase
      .from("attendance_sessions")
      .select(
        "id, user_id, branch_id, department_id, clock_in_at, clock_out_at, year_month, source, note",
      )
      .eq("user_id", userId)
      .eq("year_month", data.yearMonth)
      .is("deleted_at", null)
      .order("clock_in_at", { ascending: false });
    if (error) {
      if (/does not exist|relation/i.test(error.message)) {
        return { sessions: [], total_minutes: 0, open: null };
      }
      throw new Error(error.message);
    }

    const sessions: AttendanceSession[] = (rows ?? []).map((r: any) => ({
      ...r,
      duration_minutes: durationMinutes(r.clock_in_at, r.clock_out_at),
    }));
    const open = sessions.find((s) => !s.clock_out_at) ?? null;
    const total_minutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    return { sessions, total_minutes, open };
  });

export const getAttendanceLookup = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
      employeeId: z.string().uuid().optional(),
      departmentId: z.string().uuid().optional(),
      idNumber: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data: capsRaw, error: capsErr } = await supabase.rpc("get_attendance_my_capabilities", {
      _branch_id: data.branchId,
    });
    if (capsErr) {
      if (/does not exist|function/i.test(capsErr.message)) return { sessions: [], total_minutes: 0 };
      throw new Error(capsErr.message);
    }
    const caps = mapCaps(capsRaw as Record<string, unknown>);
    if (!caps.can_view && !caps.is_platform_owner) throw new Error("Forbidden");

    let employeeIds: string[] | null = null;
    if (data.employeeId) {
      employeeIds = [data.employeeId];
    } else if (data.idNumber?.trim()) {
      const { data: profs, error } = await supabase
        .from("profiles")
        .select("id")
        .eq("branch_id", data.branchId)
        .eq("id_number", data.idNumber.trim());
      if (error) throw new Error(error.message);
      employeeIds = (profs ?? []).map((p: any) => p.id);
      if (employeeIds.length === 0) return { sessions: [], total_minutes: 0 };
    }

    let q = supabase
      .from("attendance_sessions")
      .select(
        "id, user_id, branch_id, department_id, clock_in_at, clock_out_at, year_month, source, note",
      )
      .eq("branch_id", data.branchId)
      .eq("year_month", data.yearMonth)
      .is("deleted_at", null)
      .order("clock_in_at", { ascending: false });

    if (employeeIds) q = q.in("user_id", employeeIds);
    if (data.departmentId) q = q.eq("department_id", data.departmentId);

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    const userIds = [...new Set((rows ?? []).map((r: any) => r.user_id))];
    const deptIds = [...new Set((rows ?? []).map((r: any) => r.department_id).filter(Boolean))];

    const [{ data: profiles }, { data: depts }] = await Promise.all([
      userIds.length
        ? supabase.from("profiles").select("id, full_name, id_number").in("id", userIds)
        : Promise.resolve({ data: [] as any[] }),
      deptIds.length
        ? supabase.from("departments").select("id, name").in("id", deptIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
    const idById = new Map((profiles ?? []).map((p: any) => [p.id, p.id_number]));
    const deptById = new Map((depts ?? []).map((d: any) => [d.id, d.name]));

    const sessions: AttendanceSession[] = (rows ?? []).map((r: any) => ({
      ...r,
      duration_minutes: durationMinutes(r.clock_in_at, r.clock_out_at),
      employee_name: nameById.get(r.user_id) ?? null,
      id_number: idById.get(r.user_id) ?? null,
      department_name: r.department_id ? (deptById.get(r.department_id) ?? null) : null,
    }));
    const total_minutes = sessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    return { sessions, total_minutes, actorId: userId };
  });

export const softDeleteAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ sessionId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: result, error } = await supabase.rpc("attendance_soft_delete_session", {
      _session_id: data.sessionId,
    });
    if (error) throw new Error(error.message);
    return result;
  });

export const manualEditAttendanceSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      sessionId: z.string().uuid(),
      clockInAt: z.string().min(1),
      clockOutAt: z.string().nullable(),
      note: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const clockIn = new Date(data.clockInAt);
    if (Number.isNaN(clockIn.getTime())) throw new Error("INVALID_RANGE");
    const clockOut =
      data.clockOutAt == null || data.clockOutAt === ""
        ? null
        : new Date(data.clockOutAt);
    if (clockOut && Number.isNaN(clockOut.getTime())) throw new Error("INVALID_RANGE");
    const { data: result, error } = await supabase.rpc("attendance_manual_edit_session", {
      _session_id: data.sessionId,
      _clock_in_at: clockIn.toISOString(),
      _clock_out_at: clockOut ? clockOut.toISOString() : null,
      _note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return result;
  });

/** Map Postgres exception text → i18n key suffix */
export function attendanceErrorKey(message: string): string {
  const m = message.toUpperCase();
  if (m.includes("TOO_EARLY")) return "tooEarly";
  if (m.includes("OUTSIDE_GEOFENCE")) return "outsideGeofence";
  if (m.includes("NO_SHIFT_TODAY") || m.includes("NO_SHIFT")) return "noShiftToday";
  if (m.includes("ALREADY_CLOCKED_IN")) return "alreadyIn";
  if (m.includes("NOT_CLOCKED_IN")) return "notIn";
  if (m.includes("GEO_NOT_CONFIGURED")) return "geoNotConfigured";
  if (m.includes("LOCATION_REQUIRED")) return "locationRequired";
  if (m.includes("FEATURE_DISABLED")) return "featureDisabled";
  if (m.includes("FORBIDDEN")) return "forbidden";
  if (m.includes("INVALID_RANGE")) return "invalidRange";
  if (m.includes("ON_LEAVE")) return "onLeave";
  if (m.includes("WRONG_BRANCH")) return "wrongBranch";
  if (m.includes("INACTIVE")) return "inactive";
  if (m.includes("ROLE_DENIED")) return "roleDenied";
  return "generic";
}

export function formatAttendanceHours(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}

function xmlEscape(v: string) {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** SpreadsheetML (.xls) — opens in Excel without extra dependencies. */
export function sessionsToExcelXml(sessions: AttendanceSession[]): string {
  const header = [
    "employee_name",
    "id_number",
    "department",
    "clock_in",
    "clock_out",
    "duration_minutes",
    "year_month",
    "source",
    "note",
  ];
  const rows = [
    header,
    ...sessions.map((s) => [
      s.employee_name ?? "",
      s.id_number ?? "",
      s.department_name ?? "",
      s.clock_in_at,
      s.clock_out_at ?? "",
      String(s.duration_minutes ?? ""),
      s.year_month,
      s.source,
      s.note ?? "",
    ]),
  ];
  const table = rows
    .map(
      (row) =>
        `<Row>${row
          .map((cell) => `<Cell><Data ss:Type="String">${xmlEscape(cell)}</Data></Cell>`)
          .join("")}</Row>`,
    )
    .join("");
  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Worksheet ss:Name="Attendance"><Table>${table}</Table></Worksheet>
</Workbook>`;
}

/** @deprecated use sessionsToExcelXml */
export function sessionsToCsv(sessions: AttendanceSession[]): string {
  return sessionsToExcelXml(sessions);
}
