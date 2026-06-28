import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
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

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createEmployeeSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept) throw new Error("מחלקה לא נמצאה");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Pre-check: prevent duplicate ID numbers. If the existing employee is inactive, surface
    // a structured error so the UI can offer reactivation instead of creating a new record.
    const { data: existing, error: exErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, is_active")
      .eq("id_number", data.id_number)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing) {
      if (existing.is_active === false) {
        throw new Error(
          `INACTIVE_EXISTS::${existing.id}::${existing.full_name ?? ""}`,
        );
      }
      throw new Error("כבר קיים עובד פעיל עם מספר זהות זה.");
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

const deleteSchema = z.object({ user_id: z.string().uuid() });

export const deleteEmployee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error("לא ניתן למחוק את החשבון של עצמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Delete avatar files from storage (entire user folder)
    try {
      const { data: files } = await supabaseAdmin.storage.from("avatars").list(data.user_id);
      if (files && files.length > 0) {
        const paths = files.map((f) => `${data.user_id}/${f.name}`);
        await supabaseAdmin.storage.from("avatars").remove(paths);
      }
    } catch {
      // non-fatal
    }

    // 2. Unlink department manager assignments
    await supabaseAdmin.from("departments").update({ manager_id: null }).eq("manager_id", data.user_id);

    // 3. Delete user_roles + profile rows explicitly (in case no FK cascade)
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("profiles").delete().eq("id", data.user_id);

    // 4. Delete auth user (permanent)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });


const resetSchema = z.object({
  user_id: z.string().uuid(),
  password: z.string().min(6).max(72),
});

export const resetEmployeePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => resetSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
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
  .middleware([requireSupabaseAuth])
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
