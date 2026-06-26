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

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  manager_id: z.string().uuid().nullable().optional(),
});

function generateCode(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 20);
  const suffix = Math.random().toString(36).slice(2, 8);
  return base ? `${base}_${suffix}` : `dept_${suffix}`;
}

async function syncManagerRole(
  supabase: any,
  opts: { newManagerId: string | null; oldManagerId: string | null; deptId: string },
) {
  const { newManagerId, oldManagerId, deptId } = opts;
  if (newManagerId === oldManagerId) return;

  // Grant department_manager to the new manager (idempotent).
  if (newManagerId) {
    const { error } = await supabase
      .from("user_roles")
      .upsert(
        { user_id: newManagerId, role: "department_manager" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );
    if (error) throw new Error(error.message);
  }

  // Revoke department_manager from the previous manager IFF they no longer manage any department.
  if (oldManagerId) {
    const { data: stillManages, error: chkErr } = await supabase
      .from("departments")
      .select("id")
      .eq("manager_id", oldManagerId)
      .neq("id", deptId)
      .limit(1);
    if (chkErr) throw new Error(chkErr.message);
    if (!stillManages || stillManages.length === 0) {
      const { error: delErr } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", oldManagerId)
        .eq("role", "department_manager");
      if (delErr) throw new Error(delErr.message);
    }
  }
}

export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertMainAdmin(context.supabase, context.userId);
    let lastErr: any = null;
    for (let i = 0; i < 5; i++) {
      const code = generateCode(data.name);
      const { data: inserted, error } = await context.supabase
        .from("departments")
        .insert({
          name: data.name,
          code,
          manager_id: data.manager_id ?? null,
        })
        .select("id, manager_id")
        .single();
      if (!error) {
        await syncManagerRole(context.supabase, {
          newManagerId: inserted.manager_id ?? null,
          oldManagerId: null,
          deptId: inserted.id,
        });
        return { ok: true };
      }
      lastErr = error;
      if (error.code !== "23505") break;
    }
    throw new Error(lastErr?.message ?? "שגיאה ביצירת מחלקה");
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
    const { data: existing, error: exErr } = await context.supabase
      .from("departments")
      .select("manager_id")
      .eq("id", data.id)
      .single();
    if (exErr) throw new Error(exErr.message);
    const oldManagerId: string | null = existing?.manager_id ?? null;
    const newManagerId: string | null = data.manager_id ?? null;

    const patch: { name: string; manager_id: string | null; is_active?: boolean } = {
      name: data.name,
      manager_id: newManagerId,
    };
    if (typeof data.is_active === "boolean") patch.is_active = data.is_active;
    const { error } = await context.supabase.from("departments").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    await syncManagerRole(context.supabase, {
      newManagerId,
      oldManagerId,
      deptId: data.id,
    });
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
