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

const DEPARTMENTS = [
  "dairy",
  "meat",
  "produce",
  "cashiers",
  "warehouse",
  "cleaning",
  "pricing",
  "general",
] as const;

const createEmployeeSchema = z.object({
  full_name: z.string().trim().min(1).max(100),
  id_number: z.string().regex(ID_REGEX, "מספר זהות לא תקין"),
  department_id: z.string().uuid("יש לבחור מחלקה"),
  job_title: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  password: z.string().min(6).max(72),
  role: z.enum(APP_ROLES).default("employee"),
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

    // Resolve department code to feed into the handle_new_user trigger
    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("code")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept) throw new Error("מחלקה לא נמצאה");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: idEmail(data.id_number),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        id_number: data.id_number,
        department: dept.code,
        job_title: data.job_title,
        phone: data.phone,
        role: data.role,
      },
    });
    if (error) {
      const msg = error.message?.toLowerCase() ?? "";
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        throw new Error("מספר זהות זה כבר רשום במערכת");
      }
      throw new Error(error.message || "שגיאה ביצירת עובד");
    }

    // Ensure department_id is set explicitly (in case the trigger lookup differed)
    if (created.user?.id) {
      await supabaseAdmin
        .from("profiles")
        .update({ department_id: data.department_id })
        .eq("id", created.user.id);
    }

    return { id: created.user?.id ?? null };
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
      .update({ must_change_password: true })
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
