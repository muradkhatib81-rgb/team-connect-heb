import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

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

const codeRegex = /^[a-z0-9_]{2,40}$/;

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().trim().regex(codeRegex, "קוד באנגלית בלבד, אותיות קטנות/מספרים/קו תחתון"),
  manager_id: z.string().uuid().nullable().optional(),
});

export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from("departments").insert({
      name: data.name,
      code: data.code,
      manager_id: data.manager_id ?? null,
    });
    if (error) {
      if (error.code === "23505") throw new Error("קוד מחלקה כבר קיים");
      throw new Error(error.message);
    }
    return { ok: true };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  manager_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
});

export const updateDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    const patch: Record<string, any> = { name: data.name, manager_id: data.manager_id ?? null };
    if (typeof data.is_active === "boolean") patch.is_active = data.is_active;
    const { error } = await context.supabase.from("departments").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    const { count, error: cErr } = await context.supabase
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("department_id", data.id);
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) throw new Error("לא ניתן למחוק מחלקה עם עובדים משויכים");
    const { error } = await context.supabase.from("departments").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
