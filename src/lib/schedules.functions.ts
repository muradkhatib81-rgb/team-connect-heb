import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const SHIFT = ["morning", "evening", "off"] as const;

async function getCaps(supabase: any, userId: string) {
  const [{ data: roles }, { data: perm }, { data: profile }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase.from("user_task_permissions").select("*").eq("user_id", userId).maybeSingle(),
    supabase.from("profiles").select("department_id").eq("id", userId).maybeSingle(),
  ]);
  const set = new Set((roles ?? []).map((r: any) => r.role));
  const p: any = perm ?? {};
  const isMainAdmin = set.has("main_admin");
  const isBranchMgr = set.has("branch_manager") || set.has("assistant_manager");
  const isDeptMgr = set.has("department_manager");
  return {
    isMainAdmin,
    isBranchMgr,
    isDeptMgr,
    canCreate: isMainAdmin || isDeptMgr || (isBranchMgr && !!p.can_create_schedule),
    canApprove: isMainAdmin || (isBranchMgr && !!p.can_approve_schedule),
    canPublishDirect: isMainAdmin || (isBranchMgr && !!p.can_publish_schedule),
    departmentId: profile?.department_id ?? null,
  };
}


// Normalize a date string (YYYY-MM-DD) to the start of its ISO-week-like week (Sunday).
function weekStartOf(dateStr: string): { start: string; end: string } {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = d.getUTCDay(); // 0=Sun
  const start = new Date(d);
  start.setUTCDate(d.getUTCDate() - dow);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const iso = (x: Date) => x.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}

// ---------- CREATE / GET-OR-CREATE schedule ----------
const upsertSchema = z.object({
  department_id: z.string().uuid(),
  week_start: z.string(),
});

export const createOrGetSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { data: inserted, error } = await context.supabase
      .from("schedules")
      .insert({
        department_id: data.department_id,
        week_start: start,
        week_end: end,
        status: "draft",
        created_by: context.userId,
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
const saveShiftsSchema = z.object({
  schedule_id: z.string().uuid(),
  shifts: z.array(
    z.object({
      employee_id: z.string().uuid(),
      day_date: z.string(),
      shift: z.enum(SHIFT),
    }),
  ),
});

export const saveScheduleShifts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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

    // Snapshot existing shifts for change detection + preserve published_shift snapshot
    const { data: existingShifts } = await context.supabase
      .from("schedule_shifts")
      .select("employee_id, day_date, shift, published_shift")
      .eq("schedule_id", data.schedule_id);
    const keyOf = (s: { employee_id: string; day_date: string; shift: string }) =>
      `${s.employee_id}|${s.day_date}|${s.shift}`;
    const beforeSet = new Set((existingShifts ?? []).map(keyOf));
    const afterSet = new Set(data.shifts.map(keyOf));
    const changed =
      beforeSet.size !== afterSet.size ||
      [...beforeSet].some((k) => !afterSet.has(k)) ||
      [...afterSet].some((k) => !beforeSet.has(k));

    // Preserve published_shift snapshot across delete+insert (only meaningful for approved schedules)
    const pubMap = new Map<string, string | null>();
    for (const s of existingShifts ?? []) {
      pubMap.set(`${s.employee_id}|${s.day_date}`, (s as any).published_shift ?? null);
    }

    // Replace all shifts for the schedule (simpler + atomic-ish)
    const { error: delErr } = await context.supabase
      .from("schedule_shifts")
      .delete()
      .eq("schedule_id", data.schedule_id);
    if (delErr) throw new Error(delErr.message);
    if (data.shifts.length) {
      const rows = data.shifts.map((s) => ({
        ...s,
        schedule_id: data.schedule_id,
        // For approved schedules, carry the published snapshot forward so the
        // "modified after publish" marker persists. For drafts, leave null.
        published_shift: isApproved
          ? (pubMap.get(`${s.employee_id}|${s.day_date}`) ?? null)
          : null,
      }));
      const { error: insErr } = await context.supabase.from("schedule_shifts").insert(rows);
      if (insErr) throw new Error(insErr.message);
    }
    await context.supabase
      .from("schedules")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", data.schedule_id);
    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "updated",
      });

    if (isApproved && changed) {
      // All department employees + the department manager (in case they're not in the dept)
      const [{ data: emps }, { data: dept }] = await Promise.all([
        context.supabase
          .from("profiles")
          .select("id")
          .eq("department_id", sched.department_id),
        context.supabase
          .from("departments")
          .select("manager_id")
          .eq("id", sched.department_id)
          .maybeSingle(),
      ]);
      const recipientIds = new Set<string>((emps ?? []).map((e: any) => e.id));
      if (dept?.manager_id) recipientIds.add(dept.manager_id);
      if (recipientIds.size) {
        const { error: notifErr } = await context.supabase
          .from("schedule_notifications")
          .insert(
            [...recipientIds].map((uid) => ({
              schedule_id: data.schedule_id,
              user_id: uid,
              message: "סידור העבודה השבועי עודכן. נא לעיין בשינויים.",
            })),
          );
        if (notifErr) throw new Error(notifErr.message);
      }
    }
    return { ok: true, notified: isApproved && changed };
  });

// ---------- SUBMIT for approval ----------
export const submitSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const [{ data: shifts }, { data: deptEmployees }] = await Promise.all([
      context.supabase
        .from("schedule_shifts")
        .select("employee_id, day_date, shift")
        .eq("schedule_id", data.schedule_id),
      context.supabase
        .from("profiles")
        .select("id, full_name, is_active")
        .eq("department_id", sched.department_id)
        .eq("is_active", true),
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

    // Auto-fill missing (employee, day) cells as "off" so an unset cell defaults
    // to a day off rather than blocking submission.
    const autoFill: { schedule_id: string; employee_id: string; day_date: string; shift: "off" }[] = [];
    for (const emp of deptEmployees ?? []) {
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
      const emp = (deptEmployees ?? []).find((e: any) => e.id === empId);
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

      // Snapshot current shifts as the published baseline (clears any prior "modified" marks).
      {
        const { data: cur } = await context.supabase
          .from("schedule_shifts")
          .select("id, shift")
          .eq("schedule_id", data.schedule_id);
        for (const row of cur ?? []) {
          await context.supabase
            .from("schedule_shifts")
            .update({ published_shift: row.shift })
            .eq("id", row.id);
        }
      }

      await context.supabase
        .from("schedule_audit_log")
        .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "published" });

      const { data: emps } = await context.supabase
        .from("profiles")
        .select("id")
        .eq("department_id", sched.department_id);
      if (emps?.length) {
        await context.supabase.from("schedule_notifications").insert(
          emps.map((e: any) => ({
            schedule_id: data.schedule_id,
            user_id: e.id,
            message: "סידור העבודה החדש פורסם.",
          })),
        );
      }
      return { ok: true, published: true };
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

    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "submitted" });
    return { ok: true, published: false };
  });


// ---------- APPROVE ----------
export const approveSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "approved",
        approved_by: context.userId,
        approved_at: now,
        published_at: now,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);

    // Snapshot current shifts as the published baseline.
    {
      const { data: cur } = await context.supabase
        .from("schedule_shifts")
        .select("id, shift")
        .eq("schedule_id", data.schedule_id);
      for (const row of cur ?? []) {
        await context.supabase
          .from("schedule_shifts")
          .update({ published_shift: row.shift })
          .eq("id", row.id);
      }
    }

    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "approved" });

    // Notify department employees
    const { data: emps } = await context.supabase
      .from("profiles")
      .select("id")
      .eq("department_id", sched.department_id);
    if (emps?.length) {
      await context.supabase.from("schedule_notifications").insert(
        emps.map((e: any) => ({
          schedule_id: data.schedule_id,
          user_id: e.id,
          message: "סידור העבודה החדש פורסם.",
        })),
      );
    }
    return { ok: true };
  });

// ---------- REJECT ----------
export const rejectSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ schedule_id: z.string().uuid(), note: z.string().trim().min(1, "נדרשת הערה") }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const caps = await getCaps(context.supabase, context.userId);
    if (!caps.canApprove) throw new Error("אין הרשאה לדחות");
    const { data: sched } = await context.supabase
      .from("schedules")
      .select("*")
      .eq("id", data.schedule_id)
      .single();
    if (!sched) throw new Error("לא נמצא");
    if (sched.created_by === context.userId)
      throw new Error("יוצר הסידור אינו יכול לדחות בעצמו");

    const { error } = await context.supabase
      .from("schedules")
      .update({
        status: "rejected",
        rejected_by: context.userId,
        rejected_at: new Date().toISOString(),
        rejection_note: data.note,
      })
      .eq("id", data.schedule_id);
    if (error) throw new Error(error.message);
    await context.supabase
      .from("schedule_audit_log")
      .insert({
        schedule_id: data.schedule_id,
        actor_id: context.userId,
        action: "rejected",
        note: data.note,
      });
    return { ok: true };
  });

// ---------- COPY from previous week ----------
export const copyPreviousWeek = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
      .select("employee_id, day_date, shift")
      .eq("schedule_id", prev.id);
    // Shift dates +7
    const next = (prevShifts ?? []).map((s: any) => {
      const d = new Date(s.day_date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 7);
      return {
        schedule_id: data.schedule_id,
        employee_id: s.employee_id,
        day_date: d.toISOString().slice(0, 10),
        shift: s.shift,
      };
    });
    await context.supabase.from("schedule_shifts").delete().eq("schedule_id", data.schedule_id);
    if (next.length) await context.supabase.from("schedule_shifts").insert(next);
    await context.supabase
      .from("schedule_audit_log")
      .insert({ schedule_id: data.schedule_id, actor_id: context.userId, action: "copied" });
    return { ok: true, count: next.length };
  });

// ---------- DELETE ----------
export const deleteSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
