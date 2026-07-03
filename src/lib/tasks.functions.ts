import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch";
import { z } from "zod";

const PRIORITY = ["low", "medium", "high"] as const;
const STATUS = ["new", "in_progress", "pending_approval", "pending_closure", "completed", "closed"] as const;
const FREQ = ["daily", "weekly", "monthly"] as const;

// ---------- Permission helpers (server) ----------
async function getCallerCaps(supabase: any, userId: string) {
  const [{ data: roles }, { data: perm }, { data: profile }, { data: managedDepts }] =
    await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase
        .from("user_task_permissions")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle(),
      supabase.from("profiles").select("department_id").eq("id", userId).maybeSingle(),
      supabase.from("departments").select("id").eq("manager_id", userId),
    ]);
  const roleSet = new Set((roles ?? []).map((r: any) => r.role));
  const isMainAdmin = roleSet.has("main_admin");
  const isBranchManager = roleSet.has("branch_manager");
  const isAssistantManager = roleSet.has("assistant_manager");
  const isManager = isBranchManager || isAssistantManager;
  const isAdmin = isMainAdmin || isManager;
  const p: any = perm ?? {};
  const canCreateTasks =
    isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_create_tasks));
  const canEditTasks =
    isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_edit_tasks));
  const canDeleteTasks =
    isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_delete_tasks));
  const canCloseTasks = isMainAdmin || isBranchManager || (isAssistantManager && (!!p.can_manage_tasks || !!p.can_approve_tasks));
  const isDeptManager = roleSet.has("department_manager");
  return {
    isMainAdmin,
    isAdmin,
    canCreateTasks,
    canEditTasks,
    canDeleteTasks,
    canCloseTasks,
    canManageTasks: canEditTasks, // legacy alias used elsewhere
    isDeptManager,
    departmentId: profile?.department_id ?? null,
    managedDeptIds: (managedDepts ?? []).map((d: any) => d.id) as string[],
  };
}

function canCreateForDept(caps: Awaited<ReturnType<typeof getCallerCaps>>, deptId: string) {
  return (
    caps.canCreateTasks ||
    caps.managedDeptIds.includes(deptId) ||
    (caps.isDeptManager && caps.departmentId === deptId)
  );
}
function canEditForDept(caps: Awaited<ReturnType<typeof getCallerCaps>>, deptId: string) {
  return (
    caps.canEditTasks ||
    caps.managedDeptIds.includes(deptId) ||
    (caps.isDeptManager && caps.departmentId === deptId)
  );
}

// ---------- CREATE task ----------
const TARGET_SCOPE = ["all_departments", "departments", "single_department"] as const;

const createSchema = z.object({
  title: z.string().trim().min(1, "כותרת חובה").max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  department_ids: z.array(z.string().uuid()).optional().default([]),
  target_scope: z.enum(TARGET_SCOPE).default("single_department"),
  assignee_id: z.string().uuid().optional().nullable(),
  assignee_ids: z.array(z.string().uuid()).optional().default([]),
  requires_approval: z.boolean().optional().default(true),
  due_at: z.string().datetime().optional().nullable(),
  priority: z.enum(PRIORITY).default("medium"),
  notes: z.string().trim().max(2000).optional().nullable(),
});

async function notifyUsers(supabase: any, userIds: string[], message: string) {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return;
  const rows = ids.map((uid) => ({ schedule_id: null, user_id: uid, message }));
  await supabase.from("schedule_notifications").insert(rows);
}

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    if (data.target_scope === "single_department") {
      if (!data.department_id) throw new Error("נדרשת מחלקה");
      if (!canCreateForDept(caps, data.department_id))
        throw new Error("אין הרשאה ליצור משימה במחלקה זו");
    } else {
      if (!caps.canCreateTasks)
        throw new Error("אין הרשאה ליצור משימה לכמה מחלקות / לכל הארגון");
    }
    const primaryDept =
      data.target_scope === "single_department"
        ? data.department_id
        : (data.department_ids?.[0] ?? null);
    const { data: row, error } = await context.supabase
      .from("tasks")
      .insert({
        title: data.title,
        description: data.description ?? null,
        department_id: primaryDept,
        target_scope: data.target_scope,
        requires_approval: data.requires_approval ?? true,
        assignee_id: data.assignee_id ?? null,
        due_at: data.due_at ?? null,
        priority: data.priority,
        notes: data.notes ?? null,
        created_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    if (data.target_scope === "departments" && data.department_ids?.length) {
      await context.supabase
        .from("task_departments")
        .insert(data.department_ids.map((id) => ({ task_id: row.id, department_id: id })));
    }
    if (data.assignee_ids?.length) {
      await context.supabase
        .from("task_assignees")
        .insert(data.assignee_ids.map((uid) => ({ task_id: row.id, user_id: uid })));
    }

    const notifyTargets = new Set<string>(data.assignee_ids ?? []);
    if (data.assignee_id) notifyTargets.add(data.assignee_id);
    if (data.target_scope === "all_departments") {
      const { data: emps } = await context.supabase.from("profiles").select("id").eq("is_active", true);
      (emps ?? []).forEach((e: any) => notifyTargets.add(e.id));
    } else if (data.target_scope === "departments" && data.department_ids?.length) {
      const { data: emps } = await context.supabase
        .from("profiles")
        .select("id")
        .in("department_id", data.department_ids);
      (emps ?? []).forEach((e: any) => notifyTargets.add(e.id));
    } else if (
      data.target_scope === "single_department" &&
      primaryDept &&
      !data.assignee_ids?.length &&
      !data.assignee_id
    ) {
      const { data: emps } = await context.supabase
        .from("profiles")
        .select("id")
        .eq("department_id", primaryDept);
      (emps ?? []).forEach((e: any) => notifyTargets.add(e.id));
    }
    notifyTargets.delete(context.userId);
    await notifyUsers(
      context.supabase,
      Array.from(notifyTargets),
      `הוקצתה לך משימה חדשה: ${data.title}`,
    );

    return row;
  });

// ---------- UPDATE task ----------
const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  department_id: z.string().uuid().nullable().optional(),
  department_ids: z.array(z.string().uuid()).optional(),
  target_scope: z.enum(TARGET_SCOPE).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  assignee_ids: z.array(z.string().uuid()).optional(),
  requires_approval: z.boolean().optional(),
  due_at: z.string().datetime().nullable().optional(),
  priority: z.enum(PRIORITY).optional(),
  status: z.enum(STATUS).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => updateSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, department_ids, assignee_ids, ...patch } = data;
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
    if (Object.keys(cleaned).length) {
      const { error } = await context.supabase.from("tasks").update(cleaned as any).eq("id", id);
      if (error) throw new Error(error.message);
    }
    if (department_ids) {
      await context.supabase.from("task_departments").delete().eq("task_id", id);
      if (department_ids.length) {
        await context.supabase
          .from("task_departments")
          .insert(department_ids.map((d) => ({ task_id: id, department_id: d })));
      }
    }
    if (assignee_ids) {
      const { data: existing } = await context.supabase
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", id);
      const existingSet = new Set((existing ?? []).map((r: any) => r.user_id));
      const newSet = new Set(assignee_ids);
      const toAdd = assignee_ids.filter((u) => !existingSet.has(u));
      const toRemove = Array.from(existingSet).filter((u) => !newSet.has(u as string)) as string[];
      if (toRemove.length) {
        await context.supabase
          .from("task_assignees")
          .delete()
          .eq("task_id", id)
          .in("user_id", toRemove);
      }
      if (toAdd.length) {
        await context.supabase
          .from("task_assignees")
          .insert(toAdd.map((u) => ({ task_id: id, user_id: u })));
        const { data: t } = await context.supabase
          .from("tasks")
          .select("title")
          .eq("id", id)
          .maybeSingle();
        await notifyUsers(context.supabase, toAdd, `הוקצתה לך משימה: ${t?.title ?? ""}`);
      }
    }
    return { ok: true };
  });

// ---------- ACTIVITY & COMMENTS ----------
export const listTaskActivity = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_activity_log")
      .select("id, actor_id, event, payload, created_at")
      .eq("task_id", data.task_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id).filter(Boolean)));
    let names: Record<string, string> = {};
    if (actorIds.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", actorIds);
      names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }
    return (rows ?? []).map((r: any) => ({
      ...r,
      actor_name: r.actor_id ? (names[r.actor_id] ?? null) : null,
    }));
  });

export const listTaskComments = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_comments")
      .select("id, author_id, body, created_at")
      .eq("task_id", data.task_id)
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.author_id)));
    let names: Record<string, string> = {};
    if (ids.length) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", ids);
      names = Object.fromEntries((profs ?? []).map((p: any) => [p.id, p.full_name]));
    }
    return (rows ?? []).map((r: any) => ({ ...r, author_name: names[r.author_id] ?? "—" }));
  });

export const addTaskComment = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({ task_id: z.string().uuid(), body: z.string().trim().min(1).max(2000) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("task_comments").insert({
      task_id: data.task_id,
      author_id: context.userId,
      body: data.body,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listTaskAssigneeIds = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_assignees")
      .select("user_id")
      .eq("task_id", data.task_id);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => r.user_id as string);
  });

export const listTaskDepartmentIds = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ task_id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("task_departments")
      .select("department_id")
      .eq("task_id", data.task_id);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r: any) => r.department_id as string);
  });

// ---------- DELETE task ----------
export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    if (!caps.canDeleteTasks) throw new Error("רק בעלי הרשאת מחיקת משימות יכולים למחוק");
    // Remove image files first
    const { data: imgs } = await context.supabase
      .from("task_images")
      .select("storage_path")
      .eq("task_id", data.id);
    if (imgs && imgs.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("task-images").remove(imgs.map((i: any) => i.storage_path));
    }
    const { error } = await context.supabase.from("tasks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- IMAGES ----------
const addImageSchema = z.object({
  task_id: z.string().uuid(),
  storage_path: z.string().min(1).max(500),
});

export const addTaskImage = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => addImageSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("task_images")
      .insert({
        task_id: data.task_id,
        storage_path: data.storage_path,
        uploaded_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteTaskImage = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: img } = await context.supabase
      .from("task_images")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase.from("task_images").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    if (img?.storage_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("task-images").remove([img.storage_path]);
    }
    return { ok: true };
  });

// ---------- RECURRENCES ----------
// Compute next_run_at in Asia/Jerusalem timezone.
function computeNextRunAt(
  frequency: (typeof FREQ)[number],
  days_of_week: number[],
  day_of_month: number | null,
  time_of_day: string,
  from?: Date,
): Date {
  const tz = "Asia/Jerusalem";
  const [hh, mm] = (time_of_day || "08:00").split(":").map((x) => parseInt(x, 10));
  const now = from ?? new Date();

  // Get current "wall clock" parts in TZ
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const y = parseInt(parts.year, 10);
  const m = parseInt(parts.month, 10);
  const d = parseInt(parts.day, 10);

  // Construct a UTC timestamp meant to represent "y-m-d hh:mm" in tz.
  // Simplest: compute the tz offset for that local instant and back-shift.
  function localToUtc(yy: number, mo: number, da: number, h: number, mi: number): Date {
    // approximate with two passes
    let utc = Date.UTC(yy, mo - 1, da, h, mi, 0);
    for (let i = 0; i < 2; i++) {
      const parts2 = Object.fromEntries(
        new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })
          .formatToParts(new Date(utc))
          .map((p) => [p.type, p.value]),
      );
      const localY = parseInt(parts2.year, 10);
      const localMo = parseInt(parts2.month, 10);
      const localD = parseInt(parts2.day, 10);
      const localH = parseInt(parts2.hour, 10);
      const localMi = parseInt(parts2.minute, 10);
      const desired = Date.UTC(yy, mo - 1, da, h, mi, 0);
      const actual = Date.UTC(localY, localMo - 1, localD, localH, localMi, 0);
      utc += desired - actual;
    }
    return new Date(utc);
  }

  if (frequency === "daily") {
    let candidate = localToUtc(y, m, d, hh, mm);
    if (candidate.getTime() <= now.getTime()) {
      const tmr = new Date(now.getTime() + 24 * 3600 * 1000);
      const p2 = Object.fromEntries(fmt.formatToParts(tmr).map((p) => [p.type, p.value]));
      candidate = localToUtc(
        parseInt(p2.year, 10),
        parseInt(p2.month, 10),
        parseInt(p2.day, 10),
        hh,
        mm,
      );
    }
    return candidate;
  }

  if (frequency === "weekly") {
    const dows = days_of_week.length ? days_of_week : [0, 1, 2, 3, 4, 5, 6];
    for (let i = 0; i < 8; i++) {
      const probe = new Date(now.getTime() + i * 24 * 3600 * 1000);
      const p2 = Object.fromEntries(fmt.formatToParts(probe).map((p) => [p.type, p.value]));
      const py = parseInt(p2.year, 10);
      const pm = parseInt(p2.month, 10);
      const pd = parseInt(p2.day, 10);
      const candidate = localToUtc(py, pm, pd, hh, mm);
      const dow = candidate.getUTCDay(); // good enough — DST doesn't shift weekday
      // recompute dow in tz from candidate
      const dowFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" });
      const dowName = dowFmt.format(candidate);
      const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
      const realDow = map[dowName] ?? dow;
      if (dows.includes(realDow) && candidate.getTime() > now.getTime()) {
        return candidate;
      }
    }
    // fallback in 7 days
    return new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  }

  // monthly
  const dom = day_of_month && day_of_month >= 1 && day_of_month <= 28 ? day_of_month : 1;
  let candidate = localToUtc(y, m, dom, hh, mm);
  if (candidate.getTime() <= now.getTime()) {
    const nm = m === 12 ? 1 : m + 1;
    const ny = m === 12 ? y + 1 : y;
    candidate = localToUtc(ny, nm, dom, hh, mm);
  }
  return candidate;
}

const recurrenceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  department_id: z.string().uuid(),
  assignee_id: z.string().uuid().optional().nullable(),
  priority: z.enum(PRIORITY).default("medium"),
  frequency: z.enum(FREQ),
  days_of_week: z.array(z.number().int().min(0).max(6)).default([]),
  day_of_month: z.number().int().min(1).max(28).optional().nullable(),
  time_of_day: z.string().regex(/^\d{2}:\d{2}$/).default("08:00"),
  is_active: z.boolean().default(true),
});

export const createRecurrence = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => recurrenceSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    if (!canCreateForDept(caps, data.department_id))
      throw new Error("אין הרשאה ליצור משימה חוזרת במחלקה זו");
    const next = computeNextRunAt(
      data.frequency,
      data.days_of_week,
      data.day_of_month ?? null,
      data.time_of_day,
    );
    const { data: row, error } = await context.supabase
      .from("task_recurrences")
      .insert({
        ...data,
        created_by: context.userId,
        next_run_at: next.toISOString(),
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

const updateRecSchema = recurrenceSchema.partial().extend({ id: z.string().uuid() });

export const updateRecurrence = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => updateRecSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { data: existing, error: rErr } = await context.supabase
      .from("task_recurrences")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!existing) throw new Error("משימה חוזרת לא נמצאה");
    const merged = { ...existing, ...patch };
    const next = computeNextRunAt(
      merged.frequency,
      merged.days_of_week ?? [],
      merged.day_of_month ?? null,
      merged.time_of_day ?? "08:00",
    );
    const cleaned: Record<string, any> = { next_run_at: next.toISOString() };
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) cleaned[k] = v;
    const { error } = await context.supabase
      .from("task_recurrences")
      .update(cleaned as any)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteRecurrence = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("task_recurrences")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Cron-callable: generate due recurring tasks. Authorized via apikey (anon).
export const generateDueRecurringTasks = createServerFn({ method: "POST" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabaseAdmin
    .from("task_recurrences")
    .select("*")
    .eq("is_active", true)
    .lte("next_run_at", nowIso);
  if (error) throw new Error(error.message);
  let generated = 0;
  for (const rec of due ?? []) {
    const { data: newTask, error: insErr } = await supabaseAdmin
      .from("tasks")
      .insert({
        title: rec.title,
        description: rec.description,
        department_id: rec.department_id,
        assignee_id: rec.assignee_id,
        priority: rec.priority,
        status: "new",
        due_at: rec.next_run_at,
        recurrence_id: rec.id,
        created_by: rec.created_by,
      })
      .select("id")
      .single();
    if (insErr || !newTask) continue;
    // Copy recurrence instruction images into the generated task
    const { data: recImgs } = await supabaseAdmin
      .from("task_recurrence_images")
      .select("storage_path, uploaded_by")
      .eq("recurrence_id", rec.id);
    if (recImgs && recImgs.length) {
      await supabaseAdmin.from("task_images").insert(
        recImgs.slice(0, 5).map((img: any) => ({
          task_id: newTask.id,
          storage_path: img.storage_path,
          uploaded_by: img.uploaded_by,
        })),
      );
    }
    const next = computeNextRunAt(
      rec.frequency,
      rec.days_of_week ?? [],
      rec.day_of_month ?? null,
      rec.time_of_day ?? "08:00",
      new Date(),
    );
    await supabaseAdmin
      .from("task_recurrences")
      .update({ last_generated_at: nowIso, next_run_at: next.toISOString() })
      .eq("id", rec.id);
    generated++;
  }
  return { generated };
});

// ---------- TASK PERMISSIONS (grant branch_manager / assistant_manager) ----------
const grantSchema = z.object({
  user_id: z.string().uuid(),
  can_manage_tasks: z.boolean(),
});

export const setTaskManagementPermission = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => grantSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    if (!caps.isMainAdmin) throw new Error("רק בעל המערכת יכול להעניק הרשאה זו");
    const { error } = await context.supabase
      .from("user_task_permissions")
      .upsert(
        {
          user_id: data.user_id,
          can_manage_tasks: data.can_manage_tasks,
          granted_by: context.userId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- APPROVAL WORKFLOW ----------
export const markTaskPendingApproval = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        employee_note: z.string().trim().max(2000).optional().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: Record<string, any> = { status: "pending_approval" };
    if (data.employee_note !== undefined) patch.employee_note = data.employee_note;
    const { error } = await context.supabase.from("tasks").update(patch as any).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

async function assertCanApprove(supabase: any, userId: string, taskId: string) {
  const { data, error } = await supabase.rpc("can_approve_task", {
    _task_id: taskId,
    _approver_id: userId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין לך הרשאה לאשר משימה זו");
}

export const approveTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertCanApprove(context.supabase, context.userId, data.id);
    const { data: task, error: taskError } = await context.supabase
      .from("tasks")
      .select("created_by")
      .eq("id", data.id)
      .maybeSingle();
    if (taskError) throw new Error(taskError.message);

    let nextStatus = "completed";
    if (task?.created_by) {
      const { data: creatorRoles, error: rolesError } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", task.created_by);
      if (rolesError) throw new Error(rolesError.message);
      const roles = new Set((creatorRoles ?? []).map((r: any) => r.role));
      if (roles.has("main_admin") || roles.has("branch_manager") || roles.has("assistant_manager")) {
        nextStatus = "pending_closure";
      }
    }

    const { error } = await context.supabase
      .from("tasks")
      .update({ status: nextStatus, rejection_note: null, rejected_at: null } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const rejectTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        rejection_note: z.string().trim().min(1, "נדרשת הערה").max(2000),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertCanApprove(context.supabase, context.userId, data.id);
    const { error } = await context.supabase
      .from("tasks")
      .update({
        status: "in_progress",
        rejection_note: data.rejection_note,
        rejected_at: new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- GRANULAR USER PERMISSIONS (main admin / branch manager for assistants in-branch) ----------
export const PERMISSION_KEYS = [
  // Dashboard
  "can_view_dashboard",
  // Employees
  "can_view_all_employees",
  "can_view_employee_details",
  "can_add_employee",
  "can_edit_employee",
  "can_delete_employee",
  "can_reset_employee_password",
  "can_manage_departments",
  "can_export_employees",
  // Schedules
  "can_view_schedule",
  "can_create_schedule",
  "can_edit_schedule",
  "can_approve_schedule",
  "can_publish_schedule",
  // Leave
  "can_view_leave",
  "can_approve_leave",
  "can_reject_leave",
  "can_edit_leave_balance",
  // Breaks
  "can_view_breaks",
  "can_manage_breaks",
  // Tasks
  "can_view_tasks",
  "can_create_tasks",
  "can_edit_tasks",
  "can_delete_tasks",
  "can_approve_tasks",
  // Messages / Communication Center
  "can_view_messages",
  "can_send_messages",
  "can_send_message_employee",
  "can_send_message_department",
  "can_send_message_all",
  
  "can_manage_communications",
  "can_delete_communications",
  "can_view_read_receipts",
  // Reports
  "can_view_reports",
  "can_export_reports",
  // System
  "can_manage_permissions",
  "can_manage_company_settings",
  "can_view_activity_log",
  "can_manage_users",
  // Employee Recognition
  "can_manage_employee_of_month",
  // Morning Board
  "can_manage_morning_board",
] as const;

const setPermsSchema = z.object({
  user_id: z.string().uuid(),
  perms: z.object(
    Object.fromEntries(PERMISSION_KEYS.map((k) => [k, z.boolean()])) as Record<
      (typeof PERMISSION_KEYS)[number],
      z.ZodBoolean
    >,
  ),
});

export const setUserPermissions = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => setPermsSchema.parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    const { data: callerRoles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    const callerRoleSet = new Set((callerRoles ?? []).map((r: any) => r.role));
    const callerIsBranchManager = callerRoleSet.has("branch_manager");

    const { data: target, error: targetError } = await context.supabase
      .from("profiles")
      .select("id, branch_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (targetError) throw new Error(targetError.message);
    if (!target) throw new Error("המשתמש לא נמצא בסניף הפעיל");

    if (!caps.isMainAdmin && !callerIsBranchManager) {
      throw new Error("אין הרשאה לנהל הרשאות");
    }

    if (callerIsBranchManager && !caps.isMainAdmin) {
      if (data.user_id === context.userId) throw new Error("לא ניתן לערוך את ההרשאות של עצמך");
      const { data: targetRoles, error: rolesError } = await context.supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", data.user_id);
      if (rolesError) throw new Error(rolesError.message);
      const roles = new Set((targetRoles ?? []).map((r: any) => r.role));
      if (!roles.has("assistant_manager")) {
        throw new Error("מנהל סניף יכול לנהל הרשאות רק לסגן מנהל באותו סניף");
      }
    }

    const row: Record<string, any> = {
      user_id: data.user_id,
      branch_id: (target as any).branch_id,
      granted_by: context.userId,
      updated_at: new Date().toISOString(),
      ...data.perms,
    };
    // Maintain legacy can_manage_tasks consistent with full task control
    row.can_manage_tasks =
      data.perms.can_create_tasks && data.perms.can_edit_tasks && data.perms.can_delete_tasks;
    const { error } = await context.supabase
      .from("user_task_permissions")
      .upsert(row as any, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- FINAL CLOSURE ----------
export const closeTask = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const caps = await getCallerCaps(context.supabase, context.userId);
    if (!caps.canCloseTasks) throw new Error("רק בעל המערכת או בעלי הרשאת ניהול/אישור משימות יכולים לסגור משימה");
    const { error } = await context.supabase
      .from("tasks")
      .update({ status: "closed" } as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- RECURRENCE INSTRUCTION IMAGES ----------
export const addRecurrenceImage = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) =>
    z.object({
      recurrence_id: z.string().uuid(),
      storage_path: z.string().min(1).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("task_recurrence_images")
      .insert({
        recurrence_id: data.recurrence_id,
        storage_path: data.storage_path,
        uploaded_by: context.userId,
      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteRecurrenceImage = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: img } = await context.supabase
      .from("task_recurrence_images")
      .select("storage_path")
      .eq("id", data.id)
      .maybeSingle();
    const { error } = await context.supabase
      .from("task_recurrence_images")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    if (img?.storage_path) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      await supabaseAdmin.storage.from("task-images").remove([img.storage_path]);
    }
    return { ok: true };
  });
