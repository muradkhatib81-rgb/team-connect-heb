import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;

type AdminClient = SupabaseClient<Database>;

function formatAuthError(error: { message?: string; code?: string } | null): string {
  const raw = error?.message?.trim();
  if (raw && raw !== "{}" && raw !== "undefined") return raw;
  if (error?.code === "email_exists") return "כבר קיים עובד עם מספר זהות זה.";
  return "שגיאה בחשבון ההתחברות של העובד. נסו שוב או פנו לתמיכה.";
}

async function findAuthUserIdByEmail(supabaseAdmin: AdminClient, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(formatAuthError(error));
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === normalized);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

/**
 * When profile was archived but auth.users remained (delete blocked by FK/triggers),
 * reuse the existing auth row and insert a fresh profile instead of delete+create.
 */
async function reprovisionOrphanEmployeeAuth(
  supabaseAdmin: AdminClient,
  data: CreateEmployeeInput,
  branchId: string,
): Promise<string | null> {
  const email = idEmail(data.id_number);
  const uid = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (!uid) return null;

  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (prof) return null;

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.first_name,
      last_name: data.last_name,
      id_number: data.id_number,
      department_id: data.department_id,
      job_title: data.job_title,
      phone: data.phone,
      role: data.role,
    },
  });
  if (updErr) throw new Error(formatAuthError(updErr));

  const fullName = `${data.first_name.trim()} ${data.last_name.trim()}`.trim();
  const { error: profErr } = await supabaseAdmin.from("profiles").insert({
    id: uid,
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    full_name: fullName,
    id_number: data.id_number,
    department_id: data.department_id,
    branch_id: branchId,
    job_title: data.job_title || null,
    phone: data.phone || null,
    avatar_url: data.avatar_url ?? null,
    must_change_password: true,
    is_active: true,
  });
  if (profErr) throw new Error(profErr.message);

  await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: uid, role: data.role });
  if (roleErr) throw new Error(roleErr.message);

  if (data.role === "department_manager") {
    await supabaseAdmin
      .from("departments")
      .update({ manager_id: uid })
      .eq("id", data.department_id)
      .eq("branch_id", branchId);
  }

  return uid;
}

/** Best-effort auth cleanup after archive; non-fatal when FK triggers block delete. */
async function cleanupOrphanEmployeeAuth(supabaseAdmin: AdminClient, idNumber: string) {
  const email = idEmail(idNumber);
  const uid = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (!uid) return;
  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (!prof) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) {
      console.error(`[cleanupOrphanEmployeeAuth] deleteUser failed for ${uid}: ${formatAuthError(error)}`);
    }
  }
}

const ID_REGEX = /^\d{5,15}$/;

const APP_ROLES = [
  "main_admin",
  "branch_manager",
  "assistant_manager",
  "department_manager",
  "employee",
] as const;


const createEmployeeSchema = z.object({
  first_name: z.string().trim().min(1, "יש למלא שם פרטי").max(50),
  last_name: z.string().trim().min(1, "יש למלא שם משפחה").max(50),
  id_number: z.string().regex(ID_REGEX, "מספר זהות לא תקין"),
  department_id: z.string().uuid("יש לבחור מחלקה"),
  job_title: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  password: z.string().min(6).max(72),
  role: z.enum(APP_ROLES).default("employee"),
  avatar_url: z.string().trim().max(500).optional().nullable(),
});

async function getEmployeeManagerCaps(supabase: any, userId: string) {
  const [{ data: rolesRows, error }, { data: perm }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("user_task_permissions")
      .select("can_add_employee, can_edit_employee, can_delete_employee, can_reset_employee_password")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (error) throw new Error("שגיאת הרשאות");
  const roles = (rolesRows ?? []).map((r: any) => r.role as string);
  const isMainAdmin = roles.includes("main_admin");
  const isSystemAdmin = roles.includes("system_admin");
  const isPlatformOwner = isMainAdmin || isSystemAdmin;
  const isBranchManager = roles.includes("branch_manager");
  const isAssistantManager = roles.includes("assistant_manager");
  const p: any = perm ?? {};
  return {
    roles,
    isMainAdmin,
    isSystemAdmin,
    isPlatformOwner,
    isBranchManager,
    canAdd: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_add_employee),
    canEdit: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_edit_employee),
    canDelete: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_delete_employee),
    canResetPassword:
      isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_reset_employee_password),
  };
}

function assertAssignableRole(role: (typeof APP_ROLES)[number], caps: Awaited<ReturnType<typeof getEmployeeManagerCaps>>) {
  if (caps.isPlatformOwner) return;
  if (role === "main_admin" || role === "branch_manager") {
    throw new Error("מנהל סניף אינו יכול להעניק תפקיד בעל המערכת או מנהל סניף");
  }
}

async function assertTargetIsNotProtectedManager(supabase: any, targetUserId: string, caps: Awaited<ReturnType<typeof getEmployeeManagerCaps>>) {
  if (caps.isPlatformOwner) return;
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", targetUserId);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: any) => r.role as string);
  if (roles.includes("main_admin") || roles.includes("branch_manager") || roles.includes("system_admin")) {
    throw new Error("רק בעל המערכת יכול לערוך בעל המערכת או מנהל סניף");
  }
}

async function assertProfileVisibleInActiveBranch(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("עובד לא נמצא בסניף הפעיל");
}

const createEmployeeSchemaExt = createEmployeeSchema.extend({
  force_archived: z.boolean().optional().default(false),
});

type CreateEmployeeInput = z.infer<typeof createEmployeeSchemaExt>;

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => createEmployeeSchemaExt.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canAdd) throw new Error("אין הרשאה להוספת עובד");
    assertAssignableRole(data.role, caps);

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id, branch_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept) throw new Error("מחלקה לא נמצאה");

    const branchId = (dept as { branch_id: string }).branch_id;

    // Duplicate checks via the authenticated, branch-scoped client (RLS).
    const { data: existing, error: exErr } = await context.supabase
      .from("profiles")
      .select("id, first_name, last_name, full_name, is_active, job_title, department_id, on_leave, departments(name)")
      .eq("id_number", data.id_number)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing) {
      const payload = {
        id: existing.id,
        name: [existing.first_name, existing.last_name].filter(Boolean).join(" ") || existing.full_name || "",
        job_title: existing.job_title ?? "",
        department_id: existing.department_id ?? null,
        department_name: (existing as { departments?: { name?: string } }).departments?.name ?? null,
        is_active: existing.is_active !== false,
        on_leave: !!(existing as { on_leave?: boolean }).on_leave,
      };
      throw new Error(`DUPLICATE_EMPLOYEE::${JSON.stringify(payload)}`);
    }

    if (!data.force_archived) {
      const { data: archRows, error: aErr } = await context.supabase.rpc(
        "find_archived_by_id_number",
        { _id_number: data.id_number },
      );
      if (aErr) throw new Error(aErr.message);
      const arch = (archRows as unknown[] | null)?.[0] ?? null;
      if (arch) {
        throw new Error(`ARCHIVED_EXISTS::${JSON.stringify(arch)}`);
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const reprovisionedId = await reprovisionOrphanEmployeeAuth(supabaseAdmin, data, branchId);
    if (reprovisionedId) {
      return { id: reprovisionedId };
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: idEmail(data.id_number),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        id_number: data.id_number,
        department_id: data.department_id,
        job_title: data.job_title,
        phone: data.phone,
        role: data.role,
      },
    });
    if (error) {
      const msg = formatAuthError(error).toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        const fallbackId = await reprovisionOrphanEmployeeAuth(supabaseAdmin, data, branchId);
        if (fallbackId) return { id: fallbackId };
        throw new Error("כבר קיים עובד עם מספר זהות זה.");
      }
      throw new Error(formatAuthError(error) || "שגיאה ביצירת עובד");
    }

    const newUserId = created.user?.id ?? null;
    if (newUserId) {
      await supabaseAdmin
        .from("profiles")
        .update({
          department_id: data.department_id,
          branch_id: branchId,
          avatar_url: data.avatar_url ?? null,
        })
        .eq("id", newUserId);

      await supabaseAdmin.from("user_roles").delete().eq("user_id", newUserId);
      await supabaseAdmin.from("user_roles").insert({ user_id: newUserId, role: data.role });

      if (data.role === "department_manager") {
        await supabaseAdmin
          .from("departments")
          .update({ manager_id: newUserId })
          .eq("id", data.department_id)
          .eq("branch_id", branchId);
      }
    }

    return { id: newUserId };
  });

const deleteSchema = z.object({
  user_id: z.string().uuid(),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Final, irreversible removal of an employee.
 * The `archive_employee` RPC snapshots the row into `employee_archive`
 * and removes the live profile; only main admin can execute it.
 * The auth user is removed here with the service-role key.
 */
export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canDelete) throw new Error("אין הרשאה למחיקת עובד");
    if (data.user_id === context.userId) {
      throw new Error("לא ניתן למחוק את החשבון של עצמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);

    const { data: profileRow } = await supabaseAdmin
      .from("profiles")
      .select("id_number")
      .eq("id", data.user_id)
      .maybeSingle();

    // Archive snapshot + cleanup (RPC enforces branch and role authorization)
    const { error: arcErr } = await context.supabase.rpc("archive_employee", {
      _user_id: data.user_id,
      _reason: data.reason ?? undefined,
    });
    if (arcErr) throw new Error(arcErr.message);

    // Delete avatar files from storage (entire user folder) — non-fatal
    try {
      const { data: files } = await supabaseAdmin.storage.from("avatars").list(data.user_id);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${data.user_id}/${f.name}`);
        await supabaseAdmin.storage.from("avatars").remove(paths);
      }
    } catch {
      // non-fatal
    }

    // Delete auth user (profile + roles were already removed by the RPC)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      if (profileRow?.id_number) {
        await cleanupOrphanEmployeeAuth(supabaseAdmin, profileRow.id_number);
      } else {
        throw new Error(
          error.message ||
            "העובד הועבר לארכיון אך מחיקת חשבון ההתחברות נכשלה. נסו שוב.",
        );
      }
    }

    return { ok: true };
  });



const resetSchema = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(6).max(72),
});

export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => resetSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canResetPassword) throw new Error("אין הרשאה לאיפוס סיסמה");
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", data.user_id);
    return { ok: true };
  });

const changeOwnPasswordSchema = z.object({
  password: z.string().min(6).max(72),
});

export const changeOwnPassword = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => changeOwnPasswordSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.updateUserById(context.userId, {
      password: data.password,
    });
    if (error) throw new Error(error.message);
    const { error: pErr } = await supabaseAdmin
      .from("profiles")
      .update({ must_change_password: false })
      .eq("id", context.userId);
    if (pErr) throw new Error(pErr.message);
    return { ok: true };
  });

const setActiveSchema = z.object({
  user_id: z.string().uuid(),
  is_active: z.boolean(),
  note: z.string().trim().max(500).optional(),
});

const updateEmployeeSchema = z.object({
  user_id: z.string().uuid(),
  first_name: z.string().trim().min(1, "יש למלא שם פרטי").max(50),
  last_name: z.string().trim().min(1, "יש למלא שם משפחה").max(50),
  id_number: z.string().regex(ID_REGEX, "מספר זהות לא תקין").nullable().optional(),
  department_id: z.string().uuid("יש לבחור מחלקה"),
  phone: z.string().trim().max(20).optional().default(""),
  job_title: z.string().trim().max(80).optional().default(""),
  on_leave: z.boolean(),
  leave_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leave_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  is_active: z.boolean(),
  is_active_changed: z.boolean(),
  avatar_url: z.string().trim().max(500).nullable().optional(),
  role: z.enum(APP_ROLES).optional(),
  role_changed: z.boolean().optional().default(false),
});

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => updateEmployeeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canEdit) throw new Error("אין הרשאה לעריכת עובד");
    if (!context.branchId) throw new Error("יש לבחור סניף פעיל");

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);

    if (data.user_id === context.userId && data.is_active_changed && !data.is_active) {
      throw new Error("לא ניתן להשבית את החשבון של עצמך");
    }

    let leaveStart = data.leave_start_date ?? null;
    let leaveEnd = data.leave_end_date ?? null;
    if (data.on_leave) {
      if (!leaveStart || !leaveEnd) {
        throw new Error("יש להזין תאריך התחלה וסיום לחופשה");
      }
      if (leaveEnd < leaveStart) {
        throw new Error("תאריך סיום החופשה חייב להיות אחרי תאריך ההתחלה");
      }
    } else {
      leaveStart = null;
      leaveEnd = null;
    }

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id, branch_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept || (dept as { branch_id: string }).branch_id !== context.branchId) {
      throw new Error("מחלקה לא נמצאה בסניף הפעיל");
    }

    if (data.is_active_changed) {
      const { error: activeErr } = await context.supabase.rpc("set_employee_active", {
        _user_id: data.user_id,
        _active: data.is_active,
      });
      if (activeErr) throw new Error(activeErr.message);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({
        first_name: data.first_name.trim(),
        last_name: data.last_name.trim(),
        id_number: data.id_number ?? null,
        department_id: data.department_id,
        phone: data.phone || null,
        on_leave: data.on_leave,
        leave_start_date: leaveStart,
        leave_end_date: leaveEnd,
        job_title: data.job_title || null,
        avatar_url: data.avatar_url ?? null,
        ...(data.is_active_changed ? {} : { is_active: data.is_active }),
      })
      .eq("id", data.user_id)
      .eq("branch_id", context.branchId);
    if (updErr) throw new Error(updErr.message);

    if (data.role_changed && data.role) {
      assertAssignableRole(data.role, caps);
      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.user_id, role: data.role });
      if (roleErr) throw new Error(roleErr.message);

      if (data.role === "department_manager") {
        await supabaseAdmin
          .from("departments")
          .update({ manager_id: data.user_id })
          .eq("id", data.department_id)
          .eq("branch_id", context.branchId);
      } else {
        await supabaseAdmin
          .from("departments")
          .update({ manager_id: null })
          .eq("manager_id", data.user_id)
          .eq("branch_id", context.branchId);
      }
    }

    return { ok: true };
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => setActiveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canEdit && !caps.canDelete) throw new Error("אין הרשאה לעדכון סטטוס עובד");
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);
    if (data.user_id === context.userId && !data.is_active) {
      throw new Error("לא ניתן להשבית את החשבון של עצמך");
    }
    const { error } = await context.supabase.rpc("set_employee_active", {
      _user_id: data.user_id,
      _active: data.is_active,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

