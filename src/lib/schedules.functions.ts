import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import { z } from "zod";
import { isEmployeeOnLeaveOnDate } from "@/lib/employee-leave";

// Shift codes are dynamic — validated against public.shift_definitions at runtime.
const shiftCode = z.string().min(1).max(64);

async function getCaps(supabase: any, userId: string) {
  const [{ data: roles }, { data: perm }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("user_task_permissions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("department_id").eq("id", userId).maybeSingle(),
  ]);
  const set = new Set((roles ?? []).map((r: any) => r.role));
  const p: any = perm ?? {};
  const isMainAdmin = set.has("main_admin");
  const isBranchManager = set.has("branch_manager");
  const isAssistantManager = set.has("assistant_manager");
  const isBranchMgr = isBranchManager || isAssistantManager;
  const isDeptMgr = set.has("department_manager");
  return {
    isMainAdmin,
    isBranchMgr,
    isDeptMgr,
    canCreate: isMainAdmin || isBranchManager || isDeptMgr || !!p.can_create_schedule,
    canApprove: isMainAdmin || isBranchManager || !!p.can_approve_schedule,
    canPublishDirect: isMainAdmin || isBranchManager || !!p.can_publish_schedule,
    departmentId: profile?.department_id ?? null,
  };
}

/** Custom shift hours — platform owner, branch/assistant managers, or granular approve/publish only. */
function canEditScheduleTimes(caps: {
  isMainAdmin: boolean;
  isBranchMgr: boolean;
  canApprove: boolean;
  canPublishDirect: boolean;
}) {
  return caps.isMainAdmin || caps.isBranchMgr || caps.canApprove || caps.canPublishDirect;
}

function stripShiftCustomTimes<
  T extends { shift: string; start_time?: string | null; end_time?: string | null },
>(shifts: T[]): T[] {
  return shifts.map((s) => ({
    ...s,
    start_time: null,
    end_time: null,
  }));
}

async function getDepartmentScheduleEmployees(supabase: any, departmentId: string) {
  const [{ data: emps }, { data: dept }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, full_name, is_active, excluded_from_schedule, on_leave, leave_start_date, leave_end_date")
      .eq("department_id", departmentId)
      .eq("is_active", true),
    supabase
      .from("departments")
      .select("manager_id")
      .eq("id", departmentId)
      .maybeSingle(),
  ]);

  const rows = [...(emps ?? [])];
  if (dept?.manager_id && !rows.some((e: any) => e.id === dept.manager_id)) {
    const { data: mgr } = await supabase
      .from("profiles")
      .select("id, full_name, is_active, excluded_from_schedule, on_leave, leave_start_date, leave_end_date")
      .eq("id", dept.manager_id)
      .eq("is_active", true)
      .maybeSingle();
    if (mgr) rows.push(mgr as any);
  }
  return rows;
}

function schedulableDepartmentEmployees(employees: any[]) {
  return (employees ?? []).filter((e: any) => !e.excluded_from_schedule);
}

function weekDaysOfSchedule(sched: { week_start: string }): string[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sched.week_start + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

/** Force חופש (off) on leave days before save/submit validation. */
function applyLeaveOffToShifts(
  sched: { week_start: string },
  deptEmployees: any[],
  shifts: {
    employee_id: string;
    day_date: string;
    shift: string;
    start_time?: string | null;
    end_time?: string | null;
  }[],
) {
  const schedulable = schedulableDepartmentEmployees(deptEmployees);
  const days = weekDaysOfSchedule(sched);
  const byCell = new Map<string, (typeof shifts)[number]>();
  for (const s of shifts) byCell.set(`${s.employee_id}|${s.day_date}`, s);
  for (const emp of schedulable) {
    for (const day of days) {
      if (!isEmployeeOnLeaveOnDate(emp, day)) continue;
      const key = `${emp.id}|${day}`;
      const prev = byCell.get(key);
      byCell.set(key, {
        ...(prev ?? { employee_id: emp.id, day_date: day }),
        employee_id: emp.id,
        day_date: day,
        shift: "off",
        start_time: null,
        end_time: null,
      });
    }
  }
  return [...byCell.values()];
}

function applyLeaveOffToShiftMap(
  sched: { week_start: string },
  deptEmployees: any[],
  map: Map<string, Map<string, string[]>>,
) {
  const schedulable = schedulableDepartmentEmployees(deptEmployees);
  const days = weekDaysOfSchedule(sched);
  for (const emp of schedulable) {
    let m = map.get(emp.id);
    if (!m) {
      m = new Map();
      map.set(emp.id, m);
    }
    for (const day of days) {
      if (isEmployeeOnLeaveOnDate(emp, day)) m.set(day, ["off"]);
    }
  }
}


type PublishedShiftSnapshot = string | null;

function scheduleCellSaveSignature(s: {
  employee_id: string;
  day_date: string;
  shift: string;
  start_time?: string | null;
  end_time?: string | null;
  note?: string | null;
}): string {
  const hm = (v: string | null | undefined) => {
    if (!v) return "";
    return String(v).trim().slice(0, 5);
  };
  const note = s.note?.trim().slice(0, 10) ?? "";
  return `${s.employee_id}|${s.day_date}|${s.shift}|${hm(s.start_time)}|${hm(s.end_time)}|${note}`;
}

async function getScheduleDepartmentRecipientIds(
  supabase: any,
  departmentId: string,
  excludeUserId?: string | null,
): Promise<string[]> {
  const [{ data: emps }, { data: dept }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id")
      .eq("department_id", departmentId)
      .eq("is_active", true),
    supabase.from("departments").select("manager_id").eq("id", departmentId).maybeSingle(),
  ]);
  const ids = new Set<string>((emps ?? []).map((e: any) => e.id as string));
  if (dept?.manager_id) ids.add(dept.manager_id as string);
  if (excludeUserId) ids.delete(excludeUserId);
  return [...ids];
}

async function notifyScheduleDepartment(
  supabase: any,
  scheduleId: string,
  departmentId: string,
  message: string,
  excludeUserId?: string | null,
) {
  const recipientIds = await getScheduleDepartmentRecipientIds(
    supabase,
    departmentId,
    excludeUserId,
  );
  if (!recipientIds.length) return;
  await supabase.from("schedule_notifications").insert(
    recipientIds.map((uid) => ({
      schedule_id: scheduleId,
      user_id: uid,
      message,
    })),
  );
}

async function snapshotPublishedShifts(supabase: any, scheduleId: string) {
  const { data: cur } = await supabase
    .from("schedule_shifts")
    .select("id, shift, start_time, end_time, note")
    .eq("schedule_id", scheduleId);
  for (const row of cur ?? []) {
    await supabase
      .from("schedule_shifts")
      .update({
        published_shift: row.shift,
        published_start_time: row.start_time ?? null,
        published_end_time: row.end_time ?? null,
        published_note: row.note ?? null,
      })
      .eq("id", row.id);
  }
}

// Normalize a date string (YYYY-MM-DD) to the start of its ISO-week-like week (Sunday).
function weekStartOf(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + "T00:00:00Z");
  // Week starts on Saturday. getUTCDay(): 0=Sun..6=Sat → days since Saturday = (dow + 1) % 7
  const dowFromSat = (d.getUTCDay() + 1) % 7;
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dowFromSat);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

function isScheduleVisibleToCaps(schedule: any, caps: any) {
  if (caps.isMainAdmin || caps.isBranchMgr) return true;
  if (!caps.isDeptMgr) return true;
  if (!["draft", "rejected"].includes(schedule?.status)) return true;
  return schedule?.department_id === caps.departmentId;
}

// ---------- LIST schedules visible to the current user ----------
export const getSchedulesForViewer = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        week_start: z.string(),
        department_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    let query = context.supabase
      .from("schedules")
      .select("*")
      .eq("week_start", data.week_start);
    if (data.department_id) query = query.eq("department_id", data.department_id);

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);
    return (rows ?? []).filter((schedule: any) => isScheduleVisibleToCaps(schedule, caps));
  });

// ---------- CREATE / GET-OR-CREATE schedule ----------
const upsertSchema = z.object({
  department_id: z.string().uuid(),
  week_start: z.string(),
});

export const createOrGetSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => upsertSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canCreate) throw new Error("אין הרשאה ליצור סידור עבודה");
    if (caps.isDeptMgr && !caps.isMainAdmin && !caps.isBranchMgr) {
      if (data.department_id !== caps.departmentId) {
        throw new Error("ניתן ליצור סידור רק עבור המחלקה שלך");
      }
    }
    const { start, end } = weekStartOf(data.week_start);
    const existing = await context.supabase
      .from("schedules")
      .select("*")
      .eq("department_id", data.department_id)
      .eq("week_start", start)
      .maybeSingle();
    if (existing.data) return existing.data;
    const { data: settings } = await context.supabase
      .from("company_settings")
      .select("schedule_type")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const scheduleType = (settings as any)?.schedule_type ?? "weekly";
    const { data: inserted, error } = await context.supabase
      .from("schedules")
      .insert({
        department_id: data.department_id,
        week_start: start,
        week_end: end,
        status: "draft",
        created_by: context.userId,
        schedule_type: scheduleType,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: inserted.id, actor_id: context.userId, action: "created" });
    return inserted;
  });

// ---------- SAVE shifts (bulk) ----------
const timeStr = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/, "פורמט שעה לא תקין")
  .nullable()
  .optional();

const scheduleNoteSchema = z
  .string()
  .trim()
  .max(10)
  .nullable()
  .optional()
  .transform((v) => (v && v.length > 0 ? v : null));

const saveShiftsSchema = z.object({
  schedule_id: z.string().uuid(),
  shifts: z.array(
    z.object({
      employee_id: z.string().uuid(),
      day_date: z.string(),
      shift: shiftCode,
      start_time: timeStr,
      end_time: timeStr,
      note: scheduleNoteSchema,
    }),
  ),
});

export const saveScheduleShifts = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => saveShiftsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched, error: se } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (se || !sched) throw new Error("סידור לא נמצא");
    const caps = await getCaps(context.supabase, context.userId);
    const isApproved = sched.status === "approved";
    const isPendingApproval = sched.status === "pending_approval";
    if (isApproved) {
      if (!caps.isMainAdmin && !caps.canPublishDirect) {
        throw new Error("אין הרשאה לערוך סידור מאושר");
      }
    } else if (isPendingApproval) {
      if (!caps.isMainAdmin && !caps.canApprove && !caps.canPublishDirect) {
        throw new Error("אין הרשאה לערוך סידור הממתין לאישור");
      }
    } else if (!["draft", "rejected"].includes(sched.status)) {
      throw new Error("לא ניתן לערוך סידור בסטטוס זה");
    }

    // Validate shift codes against active shift_definitions
    if (data.shifts.length) {
      const { data: defs } = await context.supabase
        .from("shift_definitions")
        .select("code, is_active");
      const validCodes = new Set((defs ?? []).filter((d: any) => d.is_active).map((d: any) => d.code));
      for (const s of data.shifts) {
        if (!validCodes.has(s.shift)) {
          throw new Error(`קוד משמרת לא תקין או לא פעיל: ${s.shift}`);
        }
      }
    }

    // Drop shifts for employees marked as not schedulable.
    const deptEmployees = await getDepartmentScheduleEmployees(context.supabase, sched.department_id);
    const schedulableIds = new Set(
      schedulableDepartmentEmployees(deptEmployees).map((e: any) => e.id as string),
    );
    const shiftsInputRaw = applyLeaveOffToShifts(
      sched,
      deptEmployees,
      data.shifts.filter((s) => schedulableIds.has(s.employee_id)),
    );
    const shiftsInput = canEditScheduleTimes(caps)
      ? shiftsInputRaw
      : stripShiftCustomTimes(shiftsInputRaw);

    // Snapshot existing shifts for change detection + preserve published_shift snapshot
    const { data: existingShifts } = await context.supabase
      .from("schedule_shifts")
      .select(
        "employee_id, day_date, shift, published_shift, published_note, note, start_time, end_time, branch_id",
      )
      .eq("schedule_id", data.schedule_id);
    const beforeSigs = new Set((existingShifts ?? []).map(scheduleCellSaveSignature));
    const afterSigs = new Set(shiftsInput.map(scheduleCellSaveSignature));
    const changed =
      beforeSigs.size !== afterSigs.size ||
      [...beforeSigs].some((k) => !afterSigs.has(k)) ||
      [...afterSigs].some((k) => !beforeSigs.has(k));

    // Preserve published snapshot across delete+insert (approved / pending approval).
    const pubMap = new Map<string, PublishedShiftSnapshot>();
    const pubNoteMap = new Map<string, string | null>();
    const noteMap = new Map<string, string | null>();
    for (const s of existingShifts ?? []) {
      const key = `${s.employee_id}|${s.day_date}`;
      pubMap.set(key, (s as any).published_shift ?? null);
      pubNoteMap.set(key, (s as any).published_note ?? null);
      noteMap.set(key, (s as any).note ?? null);
    }
    const canEditNotes = canEditScheduleTimes(caps);

    // Replace all shifts for the schedule (simpler + atomic-ish)
    const { error: delErr } = await context.supabase
      .from("schedule_shifts")
      .delete()
      .eq("schedule_id", data.schedule_id);
    if (delErr) throw new Error(delErr.message);
    if (shiftsInput.length) {
      const rows = shiftsInput.map((s) => {
        const key = `${s.employee_id}|${s.day_date}`;
        return {
          ...s,
          schedule_id: data.schedule_id,
          note: canEditNotes ? ((s as any).note ?? null) : (noteMap.get(key) ?? null),
          published_shift:
            isApproved || isPendingApproval ? (pubMap.get(key) ?? null) : null,
          published_note:
            isApproved || isPendingApproval ? (pubNoteMap.get(key) ?? null) : null,
        };
      });
      const { error: insErr } = await context.supabase.from("schedule_shifts").insert(rows);
      if (insErr) {
        if (existingShifts?.length) {
          await context.supabase.from("schedule_shifts").insert(
            existingShifts.map((s: any) => ({
              schedule_id: data.schedule_id,
              employee_id: s.employee_id,
              day_date: s.day_date,
              shift: s.shift,
              published_shift: s.published_shift ?? null,
              published_note: s.published_note ?? null,
              start_time: s.start_time ?? null,
              end_time: s.end_time ?? null,
              branch_id: s.branch_id ?? null,
              ...(s.note != null ? { note: s.note } : {}),
            })),
          );
        }
        throw new Error(insErr.message);
      }
    }
    if (changed) {
      await context.supabase
        .from("schedules")
        .update({ updated_by: context.userId, updated_at: new Date().toISOString() })
        .eq("id", data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({
          schedule_id: data.schedule_id,
          actor_id: context.userId,
          action: "updated",
        });
    }

    if (isApproved && changed) {
      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי עודכן. נא לעיין בשינויים.",
        context.userId,
      );
    }
    return { ok: true, notified: isApproved && changed };
  });

// ---------- SUBMIT for approval ----------
export const submitSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("סידור לא נמצא");
    if (!["draft", "rejected"].includes(sched.status)) throw new Error("לא ניתן לשלוח שוב");

    // Validate
    const [{ data: shifts }, deptEmployees] = await Promise.all([
      context.supabase
        .from("schedule_shifts")
        .select("employee_id, day_date, shift")
        .eq("schedule_id", data.schedule_id),
      getDepartmentScheduleEmployees(context.supabase, sched.department_id),
    ]);
    const errors: string[] = [];
    const days: string[] = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(sched.week_start + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + i);
      return d.toISOString().slice(0, 10);
    });

    // Build map employee -> day -> shifts[]
    const map = new Map<string, Map<string, string[]>>();
    for (const s of shifts ?? []) {
      if (!map.has(s.employee_id)) map.set(s.employee_id, new Map());
      const m = map.get(s.employee_id)!;
      if (!m.has(s.day_date)) m.set(s.day_date, []);
      m.get(s.day_date)!.push(s.shift);
    }

    const schedulable = schedulableDepartmentEmployees(deptEmployees ?? []);
    const schedulableIds = new Set(schedulable.map((e: any) => e.id as string));

    applyLeaveOffToShiftMap(sched, deptEmployees ?? [], map);

    // Auto-fill missing (employee, day) cells as "off" so an unset cell defaults
    // to a day off rather than blocking submission.
    const autoFill: { schedule_id: string; employee_id: string; day_date: string; shift: "off" }[] = [];
    for (const emp of schedulable) {
      const m = map.get(emp.id) ?? new Map<string, string[]>();
      for (const d of days) {
        if (!m.has(d)) {
          autoFill.push({ schedule_id: data.schedule_id, employee_id: emp.id, day_date: d, shift: "off" });
          m.set(d, ["off"]);
        }
      }
      if (!map.has(emp.id)) map.set(emp.id, m);
    }
    if (autoFill.length) {
      const { error: afErr } = await context.supabase.from("schedule_shifts").insert(autoFill);
      if (afErr) throw new Error(afErr.message);
    }

    // Duplicates / off-with-shift checks per employee per day
    for (const [empId, dayMap] of map) {
      if (!schedulableIds.has(empId)) continue;
      const emp = schedulable.find((e: any) => e.id === empId);
      const name = emp?.full_name ?? "עובד";
      for (const [day, list] of dayMap) {
        if (list.length > 1) errors.push(`${name}: יותר ממשמרת אחת בתאריך ${day}`);
        if (list.includes("off") && list.some((s) => s !== "off"))
          errors.push(`${name}: חופש ומשמרת באותו יום (${day})`);
      }
    }

    if (errors.length) {
      const err: any = new Error("הסידור לא תקין: " + errors.slice(0, 5).join(" · "));
      err.details = errors;
      throw err;
    }

    const caps = await getCaps(context.supabase, context.userId);
    const nowIso = new Date().toISOString();

    if (caps.canPublishDirect) {
      // Simplified flow: a publisher hitting "publish" on a draft auto-approves
      // AND auto-publishes the schedule in a single step — no separate approve
      // button after save.
      const { error } = await context.supabase
        .from("schedules")
        .update({
          status: "approved",
          submitted_by: context.userId,
          submitted_at: nowIso,
          approved_by: context.userId,
          approved_at: nowIso,
          published_at: nowIso,
          rejection_note: null,
          rejected_at: null,
          rejected_by: null,
        })
        .eq("id", data.schedule_id);
      if (error) throw new Error(error.message);

      await context.supabase
        .from("schedule_audit_log")
        .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "approved" });

      await snapshotPublishedShifts(context.supabase, data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "published" });

      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
        context.userId,
      );

      return { ok: true, approved: true, published: true };
    }

    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "pending_approval",
        submitted_by: context.userId,
        submitted_at: nowIso,
        rejection_note: null,
        rejected_at: null,
        rejected_by: null,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    // Snapshot current shifts as the submitted baseline so we can detect
    // edits made by the approver before approval.
    await snapshotPublishedShifts(context.supabase, data.schedule_id);

    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "submitted" });
    return { ok: true, approved: false, published: false };
  });


// ---------- APPROVE ----------
export const approveSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canApprove) throw new Error("אין הרשאה לאשר סידור");
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (sched.created_by === context.userId)
      throw new Error("יוצר הסידור אינו יכול לאשר אותו בעצמו");
    if (sched.status !== "pending_approval") throw new Error("הסידור אינו ממתין לאישור");

    const now = new Date().toISOString();
    // Auto-publish on approval when the approver also has publish permission
    // (main admin / branch manager / explicit publish perm). This restores the
    // pre-update behavior in which approving a schedule made it immediately
    // visible on the dashboard of department employees and the department
    // manager. Approvers without publish permission still need a separate
    // publish step performed by a publisher.
    const autoPublish = !!caps.canPublishDirect;
    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "approved",
        approved_by: context.userId,
        approved_at: now,
        published_at: autoPublish ? now : null,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "approved",
      });

    if (autoPublish) {
      await snapshotPublishedShifts(context.supabase, data.schedule_id);
      await context.supabase
        .from("schedule_audit_log")
        .insert({
          schedule_id: data.schedule_id,
          actor_id: context.userId,
          action: "published",
        });

      await notifyScheduleDepartment(
        context.supabase,
        data.schedule_id,
        sched.department_id,
        "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
        context.userId,
      );
    }

    return { ok: true, published: autoPublish };
  });

// ---------- PUBLISH ----------
export const publishSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canPublishDirect) throw new Error("אין הרשאה לפרסם סידור");
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (sched.status !== "approved") throw new Error("ניתן לפרסם רק סידור מאושר");

    const now = new Date().toISOString();
    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "approved",
        published_at: now,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    await snapshotPublishedShifts(context.supabase, data.schedule_id);

    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "published",
      });

    await notifyScheduleDepartment(
      context.supabase,
      data.schedule_id,
      sched.department_id,
      "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
      context.userId,
    );
    return { ok: true };
  });

async function notifySchedulePublished(
  supabase: any,
  scheduleId: string,
  departmentId: string,
  excludeUserId?: string | null,
) {
  await notifyScheduleDepartment(
    supabase,
    scheduleId,
    departmentId,
    "סידור העבודה השבועי פורסם. נא לעיין בסידור המעודכן.",
    excludeUserId,
  );
}

/** Publish one unpublished schedule using the existing per-status workflow. */
async function publishOneUnpublishedSchedule(
  supabase: any,
  userId: string,
  sched: any,
  caps: Awaited<ReturnType<typeof getCaps>>,
) {
  const nowIso = new Date().toISOString();

  if (sched.status === "approved" && !sched.published_at) {
    const { error } = await supabase
      .from("schedules")
      .update({ status: "approved", published_at: nowIso })
      .eq("id", sched.id);
    if (error) throw new Error(error.message);
    await snapshotPublishedShifts(supabase, sched.id);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
    await notifySchedulePublished(supabase, sched.id, sched.department_id, sched.created_by);
    return;
  }

  if (sched.status === "pending_approval") {
    if (!caps.canApprove) throw new Error("אין הרשאה לאשר סידור");
    if (sched.created_by === userId) throw new Error("יוצר הסידור אינו יכול לאשר אותו בעצמו");
    const { error } = await supabase
      .from("schedules")
      .update({
        status: "approved",
        approved_by: userId,
        approved_at: nowIso,
        published_at: nowIso,
      })
      .eq("id", sched.id);
    if (error) throw new Error(error.message);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "approved" });
    await snapshotPublishedShifts(supabase, sched.id);
    await supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
    await notifySchedulePublished(supabase, sched.id, sched.department_id, sched.created_by);
    return;
  }

  if (!["draft", "rejected"].includes(sched.status)) {
    throw new Error("לא ניתן לפרסם סידור בסטטוס זה");
  }

  // Draft / rejected → validate shifts then publish in one step (same as submitSchedule + canPublishDirect).
  const [{ data: shifts }, deptEmployees] = await Promise.all([
    supabase
      .from("schedule_shifts")
      .select("employee_id, day_date, shift")
      .eq("schedule_id", sched.id),
    getDepartmentScheduleEmployees(supabase, sched.department_id),
  ]);
  const errors: string[] = [];
  const days: string[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sched.week_start + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  });
  const map = new Map<string, Map<string, string[]>>();
  for (const s of shifts ?? []) {
    if (!map.has(s.employee_id)) map.set(s.employee_id, new Map());
    const m = map.get(s.employee_id)!;
    if (!m.has(s.day_date)) m.set(s.day_date, []);
    m.get(s.day_date)!.push(s.shift);
  }
  const schedulable = schedulableDepartmentEmployees(deptEmployees ?? []);
  const schedulableIds = new Set(schedulable.map((e: any) => e.id as string));

  applyLeaveOffToShiftMap(sched, deptEmployees ?? [], map);

  const autoFill: { schedule_id: string; employee_id: string; day_date: string; shift: "off" }[] = [];
  for (const emp of schedulable) {
    const m = map.get(emp.id) ?? new Map<string, string[]>();
    for (const d of days) {
      if (!m.has(d)) {
        autoFill.push({ schedule_id: sched.id, employee_id: emp.id, day_date: d, shift: "off" });
        m.set(d, ["off"]);
      }
    }
    if (!map.has(emp.id)) map.set(emp.id, m);
  }
  if (autoFill.length) {
    const { error: afErr } = await supabase.from("schedule_shifts").insert(autoFill);
    if (afErr) throw new Error(afErr.message);
  }
  for (const [empId, dayMap] of map) {
    if (!schedulableIds.has(empId)) continue;
    const emp = schedulable.find((e: any) => e.id === empId);
    const name = emp?.full_name ?? "עובד";
    for (const [day, list] of dayMap) {
      if (list.length > 1) errors.push(`${name}: יותר ממשמרת אחת בתאריך ${day}`);
      if (list.includes("off") && list.some((s) => s !== "off"))
        errors.push(`${name}: חופש ומשמרת באותו יום (${day})`);
    }
  }
  if (errors.length) {
    throw new Error(errors.slice(0, 3).join(" · "));
  }

  const { error } = await supabase
    .from("schedules")
    .update({
      status: "approved",
      submitted_by: userId,
      submitted_at: nowIso,
      approved_by: userId,
      approved_at: nowIso,
      published_at: nowIso,
      rejection_note: null,
      rejected_at: null,
      rejected_by: null,
    })
    .eq("id", sched.id);
  if (error) throw new Error(error.message);
  await supabase
    .from("schedule_audit_log")
    .insert({ schedule_id: sched.id, actor_id: userId, action: "approved" });
  await snapshotPublishedShifts(supabase, sched.id);
  await supabase
    .from("schedule_audit_log")
    .insert({ schedule_id: sched.id, actor_id: userId, action: "published" });
  await notifySchedulePublished(supabase, sched.id, sched.department_id, userId);
}

// ---------- PUBLISH ALL (week) ----------
export const publishAllWeekSchedules = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ week_start: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canPublishDirect) throw new Error("אין הרשאה לפרסם סידורי עבודה");

    const { start } = weekStartOf(data.week_start);
    const { data: scheds, error } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("week_start", start);
    if (error) throw new Error(error.message);

    const unpublished = (scheds ?? []).filter(
      (s: any) => !(s.status === "approved" && s.published_at),
    );
    if (!unpublished.length) return { ok: true, published: 0, failed: 0, errors: [] as string[] };

    let published = 0;
    const errors: string[] = [];
    for (const sched of unpublished) {
      try {
        await publishOneUnpublishedSchedule(context.supabase, context.userId, sched, caps);
        published++;
      } catch (e: any) {
        const { data: dept } = await context.supabase
          .from("departments")
          .select("name")
          .eq("id", sched.department_id)
          .maybeSingle();
        errors.push(`${dept?.name ?? sched.department_id}: ${e?.message ?? "שגיאה"}`);
      }
    }

    if (published === 0 && errors.length) {
      throw new Error(errors.join("\n"));
    }
    return { ok: true, published, failed: errors.length, errors };
  });

// ---------- REJECT ----------
export const rejectSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ schedule_id: z.string().uuid(), note: z.string().trim().min(1, "נדרשת הערה") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canApprove && !caps.canPublishDirect && !caps.isMainAdmin) {
      throw new Error("אין הרשאה לדחות סידור עבודה");
    }
    const { data: sched, error: selErr } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (selErr) throw new Error(selErr.message);
    if (!sched) throw new Error("סידור לא נמצא");
    if (sched.status !== "pending_approval")
      throw new Error("ניתן לדחות רק סידור הממתין לאישור");
    if (sched.created_by === context.userId)
      throw new Error("יוצר הסידור אינו יכול לדחות בעצמו");

    const nowIso = new Date().toISOString();
    const { error: updErr } = await context.supabase
      .from("schedules")
      .update({
        status: "rejected",
        rejected_by: context.userId,
        rejected_at: nowIso,
        rejection_note: data.note,
        // Clear approval/publish state so the schedule returns cleanly
        // to the department manager for edits and re-submission.
        approved_by: null,
        approved_at: null,
        published_at: null,
      })
      .eq("id", data.schedule_id);
    if (updErr) throw new Error(updErr.message);

    const { error: auditErr } = await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "rejected",
        note: data.note,
      });
    if (auditErr) throw new Error(auditErr.message);

    // Notify the department manager / creator so they know to fix and resubmit.
    const { data: dept } = await context.supabase
      .from("departments")
      .select("manager_id")
      .eq("id", sched.department_id)
      .maybeSingle();
    const recipients = new Set<string>();
    if (sched.created_by) recipients.add(sched.created_by);
    if (dept?.manager_id) recipients.add(dept.manager_id);
    if (recipients.size) {
      await context.supabase.from("schedule_notifications").insert(
        [...recipients].map((uid) => ({
          schedule_id: data.schedule_id,
          user_id: uid,
          message: `סידור העבודה נדחה: ${data.note}`,
        })),
      );
    }
    return { ok: true };
  });

// ---------- Toggle employee schedule exclusion (roles/permissions unchanged) ----------
export const setEmployeeScheduleExclusion = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        user_id: z.string().uuid(),
        excluded: z.boolean(),
        schedule_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (
      !(
        caps.isMainAdmin ||
        caps.isBranchMgr ||
        caps.canCreate ||
        caps.canApprove ||
        caps.canPublishDirect
      )
    ) {
      throw new Error("אין הרשאה");
    }

    const { data: profile, error: pErr } = await context.supabase
      .from("profiles")
      .select("id, department_id, branch_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (pErr || !profile) throw new Error("עובד לא נמצא");
    if (context.branchId && profile.branch_id !== context.branchId) {
      throw new Error("עובד לא נמצא בסניף הפעיל");
    }
    if (caps.isDeptMgr && !caps.isMainAdmin && !caps.isBranchMgr) {
      if (profile.department_id !== caps.departmentId) {
        throw new Error("אין הרשאה לעדכן עובד מחלקה אחרת");
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({ excluded_from_schedule: data.excluded })
      .eq("id", data.user_id);
    if (updErr) throw new Error(updErr.message);

    if (data.excluded && data.schedule_id) {
      await supabaseAdmin
        .from("schedule_shifts")
        .delete()
        .eq("schedule_id", data.schedule_id)
        .eq("employee_id", data.user_id);
    }

    return { ok: true };
  });

// ---------- COPY from previous week ----------
export const copyPreviousWeek = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (!["draft", "rejected"].includes(sched.status))
      throw new Error("ניתן להעתיק רק לטיוטה");
    const prevStart = new Date(sched.week_start + "T00:00:00Z");
    prevStart.setUTCDate(prevStart.getUTCDate() - 7);
    const prevStartStr = prevStart.toISOString().slice(0, 10);
    const { data: prev } = await context.supabase
      .from("schedules")
      .select("id, week_start")
      .eq("department_id", sched.department_id)
      .eq("week_start", prevStartStr)
      .maybeSingle();
    if (!prev) throw new Error("לא קיים סידור בשבוע הקודם");
    const { data: prevShifts } = await context.supabase
      .from("schedule_shifts")
      .select("employee_id, day_date, shift, note")
      .eq("schedule_id", prev.id);
    const deptEmployees = await getDepartmentScheduleEmployees(context.supabase, sched.department_id);
    const schedulableIds = new Set(
      schedulableDepartmentEmployees(deptEmployees).map((e: any) => e.id as string),
    );
    // Shift dates +7 — skip employees not included in scheduling.
    const next = (prevShifts ?? [])
      .filter((s: any) => schedulableIds.has(s.employee_id))
      .map((s: any) => {
      const d = new Date(s.day_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7);
      return {
        schedule_id: data.schedule_id,
        employee_id: s.employee_id,
        day_date: d.toISOString().slice(0, 10),
        shift: s.shift,
        note: s.note ?? null,
      };
    });
    await context.supabase.from("schedule_shifts").delete().eq("schedule_id", data.schedule_id);
    if (next.length) await context.supabase.from("schedule_shifts").insert(next);
    await context.supabase
      .from("schedules")
      .update({ updated_by: context.userId, updated_at: new Date().toISOString() })
      .eq("id", data.schedule_id);
    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "copied" });
    return { ok: true, count: next.length };
  });

// ---------- DELETE ----------
export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ schedule_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("id, department_id, status")
      .eq("id", data.schedule_id)
      .maybeSingle();
    if (!sched) throw new Error("סידור לא נמצא");

    const isOwnDeptMgrDraft =
      caps.isDeptMgr &&
      sched.department_id === caps.departmentId &&
      (sched.status === "draft" || sched.status === "rejected");

    if (!caps.isMainAdmin && !caps.canApprove && !caps.canPublishDirect && !isOwnDeptMgrDraft) {
      throw new Error("אין הרשאה למחוק את סידור העבודה");
    }

    // Cascade: shifts, audit, notifications, then schedule
    await context.supabase.from("schedule_shifts").delete().eq("schedule_id", data.schedule_id);
    await context.supabase.from("schedule_notifications").delete().eq("schedule_id", data.schedule_id);
    await context.supabase.from("schedule_audit_log").delete().eq("schedule_id", data.schedule_id);
    const { error } = await context.supabase
      .from("schedules")
      .delete()
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- GET unpublished week summary (combined across all departments) ----------
// Returns aggregated shift counts across ALL schedules for the given week_start
// that are still unpublished (draft / pending_approval / approved-but-not-published).
// Visible only to main_admin, branch managers, or users with schedule manage
// permissions (create/approve/publish). Department managers can see the totals
// across the branch as well so they can plan jointly.
export const getUnpublishedWeekSummary = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ week_start: z.string() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    const allowed =
      caps.isMainAdmin ||
      caps.isBranchMgr ||
      caps.isDeptMgr ||
      caps.canCreate ||
      caps.canApprove ||
      caps.canPublishDirect;
    if (!allowed) throw new Error("אין הרשאה לצפות בסיכום הסידורים");

    const { start } = weekStartOf(data.week_start);

    // All unpublished schedules for the week
    const { data: scheds, error: sErr } = await context.supabase
      .from("schedules")
      .select("id, department_id, status, published_at")
      .eq("week_start", start);
    if (sErr) throw new Error(sErr.message);
    const unpublished = (scheds ?? []).filter(
      (s: any) =>
        s.status === "draft" ||
        s.status === "pending_approval" ||
        (s.status === "approved" && !s.published_at),
    );
    const visibleUnpublished = (caps.isDeptMgr && !caps.isMainAdmin && !caps.isBranchMgr
      ? unpublished.filter(
          (s: any) => !["draft", "rejected"].includes(s.status) || s.department_id === caps.departmentId,
        )
      : unpublished);
    if (visibleUnpublished.length === 0) {
      return { week_start: start, totals: {} as Record<string, number>, departments: [] as { id: string; status: string }[], total_assignments: 0 };
    }

    const schedIds = visibleUnpublished.map((s: any) => s.id);
    const { data: shiftRows, error: shErr } = await context.supabase
      .from("schedule_shifts")
      .select("schedule_id, employee_id, day_date, shift")
      .in("schedule_id", schedIds);
    if (shErr) throw new Error(shErr.message);

    // Exclude shifts of employees flagged as not counted in headcount stats.
    const empIds = Array.from(
      new Set((shiftRows ?? []).map((r: any) => r.employee_id).filter(Boolean)),
    );
    let excludedSet = new Set<string>();
    if (empIds.length > 0) {
      const { data: excluded } = await context.supabase
        .from("profiles")
        .select("id")
        .in("id", empIds)
        .or("excluded_from_headcount.eq.true,excluded_from_schedule.eq.true");
      excludedSet = new Set((excluded ?? []).map((p: any) => p.id));
    }

    // Count UNIQUE employees per shift code across the week — an employee
    // working multiple days on the same shift is one person, not many.
    const perShift: Record<string, Set<string>> = {};
    let counted = 0;
    for (const r of shiftRows ?? []) {
      const code = (r as any).shift as string | null;
      const emp = (r as any).employee_id as string | null;
      if (!code || !emp) continue;
      if (excludedSet.has(emp)) continue;
      (perShift[code] ??= new Set<string>()).add(emp);
      counted++;
    }
    const totals: Record<string, number> = {};
    for (const [code, set] of Object.entries(perShift)) totals[code] = set.size;
    return {
      week_start: start,
      totals,
      departments: visibleUnpublished.map((s: any) => ({ id: s.department_id, status: s.status })),
      total_assignments: counted,
    };
  });


// ---------- Departments states for a week (RLS-independent enumeration) ----------
// Returns, for the caller's active branch, which active departments have:
//   - no schedule row at all for the exact week_start
//   - a saved draft/pending/approved-but-unpublished schedule
//   - an approved AND published schedule
// Uses the service-role admin client so the counts are consistent for every
// authorized viewer regardless of their per-status RLS visibility.
export const getWeekDepartmentStates = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ week_start: z.string() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (
      !(
        caps.isMainAdmin ||
        caps.isBranchMgr ||
        caps.canCreate ||
        caps.canApprove ||
        caps.canPublishDirect
      )
    ) {
      throw new Error("אין הרשאה");
    }
    const { start } = weekStartOf(data.week_start);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let deptQ = supabaseAdmin
      .from("departments")
      .select("id, name, is_active, branch_id")
      .eq("is_active", true)
      .order("name");
    if (context.branchId) deptQ = deptQ.eq("branch_id", context.branchId);
    const { data: depts, error: dErr } = await deptQ;
    if (dErr) throw new Error(dErr.message);
    const activeDepts = ((depts ?? []) as any[]).map((d) => ({ id: d.id, name: d.name }));
    if (activeDepts.length === 0) {
      return {
        noSchedule: [] as { id: string; name: string }[],
        draft: [] as { id: string; name: string }[],
        published: [] as { id: string; name: string }[],
      };
    }

    const deptIds = activeDepts.map((d) => d.id);
    const { data: scheds, error: sErr } = await supabaseAdmin
      .from("schedules")
      .select("department_id, status, published_at")
      .eq("week_start", start)
      .in("department_id", deptIds);
    if (sErr) throw new Error(sErr.message);
    const byDept = new Map<string, any>();
    for (const s of (scheds ?? []) as any[]) byDept.set(s.department_id, s);

    const noSchedule: { id: string; name: string }[] = [];
    const draft: { id: string; name: string }[] = [];
    const published: { id: string; name: string }[] = [];
    for (const d of activeDepts) {
      const s = byDept.get(d.id);
      if (!s) {
        noSchedule.push(d);
        continue;
      }
      if (s.status === "approved" && s.published_at) published.push(d);
      else draft.push(d);
    }
    return { noSchedule, draft, published };
  });
