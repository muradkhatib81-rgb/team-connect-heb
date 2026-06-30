import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch";
import { z } from "zod";

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;

const ID_REGEX = /^\d{5,15}$/;

const APP_ROLES = [
  "main_admin",
  "branch_manager",
  "assistant_manager",
  "department_manager",
  "employee",
] as const;


const createEmployeeSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  id_number: z.string().regex(ID_REGEX, "מספר זהות לא תקין"),
  department_id: z.string().uuid("יש לבחור מחלקה"),
  job_title: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  password: z.string().min(6).max(72),
  role: z.enum(APP_ROLES).default("employee"),
  avatar_url: z.string().trim().max(500).optional().nullable(),
});

async function assertMainAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error("שגיאת הרשאות");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("main_admin")) {
    throw new Error("רק מנהל ראשי יכול לבצע פעולה זו");
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

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => createEmployeeSchemaExt.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id, branch_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept) throw new Error("מחלקה לא נמצאה");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pre-check active duplicates (id_number on profiles)
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, is_active, job_title, department_id, on_leave, departments(name)")
      .eq("id_number", data.id_number)
      .eq("branch_id", (dept as any).branch_id)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing) {
      const payload = {
        id: existing.id,
        name: existing.full_name ?? "",
        job_title: existing.job_title ?? "",
        department_id: existing.department_id ?? null,
        department_name: (existing as any).departments?.name ?? null,
        is_active: existing.is_active !== false,
        on_leave: !!(existing as any).on_leave,
      };
      throw new Error(`DUPLICATE_EMPLOYEE::${JSON.stringify(payload)}`);
    }

    // Pre-check archived duplicates — require explicit confirmation from the admin
    if (!data.force_archived) {
      const { data: arch, error: aErr } = await supabaseAdmin
        .from("employee_archive")
        .select("id, full_name, job_title, department_id, department_name, phone, archived_at, deactivated_at, snapshot")
        .eq("id_number", data.id_number)
        .eq("branch_id", (dept as any).branch_id)
        .order("archived_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (aErr) throw new Error(aErr.message);
      if (arch) {
        throw new Error(`ARCHIVED_EXISTS::${JSON.stringify(arch)}`);
      }
    }



    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: idEmail(data.id_number),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        id_number: data.id_number,
        department_id: data.department_id,
        job_title: data.job_title,
        phone: data.phone,
        role: data.role,
      },
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        throw new Error("כבר קיים עובד עם מספר זהות זה.");
      }
      throw new Error(error.message || "שגיאה ביצירת עובד");
    }

    const newUserId = created.user?.id ?? null;
    if (newUserId) {
      await supabaseAdmin
        .from("profiles")
        .update({
          department_id: data.department_id,
          branch_id: (dept as any).branch_id,
          avatar_url: data.avatar_url ?? null,
        })
        .eq("id", newUserId);

      if (data.role === "department_manager") {
        await supabaseAdmin
          .from("departments")
          .update({ manager_id: newUserId })
          .eq("id", data.department_id);
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
    await assertMainAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error("לא ניתן למחוק את החשבון של עצמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);

    // Archive snapshot + cleanup (RPC enforces the 30-day window and admin check)
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

    // Delete auth user (the profile + roles were already removed by the RPC)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);

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
    await assertMainAdmin(context.supabase, context.userId);
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
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

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => setActiveSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
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

