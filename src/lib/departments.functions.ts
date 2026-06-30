import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch";
import { z } from "zod";

async function assertCanManageDepartments(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (error) throw new Error("שגיאת הרשאות");
  const roles = (data ?? []).map((r: any) => r.role);
  if (!roles.includes("main_admin") && !roles.includes("system_admin")) {
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

export const createDepartment = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanManageDepartments(context.supabase, context.userId);
    let lastErr: any = null;
    for (let i = 0; i < 5; i++) {
      const code = generateCode(data.name);
      // Insert with no manager first; the RPC handles manager+role atomically.
      const { data: inserted, error } = await context.supabase
        .from("departments")
        .insert({ name: data.name, code, manager_id: null })
        .select("id")
        .single();
      if (!error) {
        if (data.manager_id) {
          const { error: rpcErr } = await context.supabase.rpc("set_department_manager", {
            _dept_id: inserted.id,
            _new_manager_id: data.manager_id,
          });
          if (rpcErr) {
            // Roll back the empty department so we don't leave an orphan.
            await context.supabase.from("departments").delete().eq("id", inserted.id);
            throw new Error(rpcErr.message);
          }
        }
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
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanManageDepartments(context.supabase, context.userId);

    // Manager change goes through the atomic RPC (updates dept + user_roles in one tx).
    const newManagerId: string | null = data.manager_id ?? null;
    const { error: rpcErr } = await context.supabase.rpc("set_department_manager", {
      _dept_id: data.id,
      _new_manager_id: newManagerId as any,
    });
    if (rpcErr) throw new Error(rpcErr.message);

    // Name / activation are independent of the manager assignment.
    const patch: { name: string; is_active?: boolean } = { name: data.name };
    if (typeof data.is_active === "boolean") patch.is_active = data.is_active;
    const { error } = await context.supabase.from("departments").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);

    return { ok: true };
  });



const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteDepartment = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertCanManageDepartments(context.supabase, context.userId);
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
