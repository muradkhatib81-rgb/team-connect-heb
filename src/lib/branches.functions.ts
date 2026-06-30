import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertSystemAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "system_admin")
    .maybeSingle();
  if (error || !data) throw new Error("רק מנהל מערכת ראשי יכול לבצע פעולה זו");
}

export const listBranchesWithStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const supabase = context.supabase;

    const { data: branches, error } = await supabase
      .from("branches")
      .select("id,name,code,address,phone,is_active,created_at,manager_id")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    const ids = (branches ?? []).map((b: any) => b.id);
    const managerIds = (branches ?? []).map((b: any) => b.manager_id).filter(Boolean);

    const [empRes, deptRes, schedRes, mgrRes] = await Promise.all([
      supabase.from("profiles").select("branch_id").in("branch_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabase.from("departments").select("branch_id").in("branch_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabase.from("schedules").select("branch_id,status,published_at").in("branch_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      managerIds.length
        ? supabase.from("profiles").select("id,full_name").in("id", managerIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const empCount: Record<string, number> = {};
    (empRes.data ?? []).forEach((p: any) => {
      if (!p.branch_id) return;
      empCount[p.branch_id] = (empCount[p.branch_id] ?? 0) + 1;
    });
    const deptCount: Record<string, number> = {};
    (deptRes.data ?? []).forEach((d: any) => {
      if (!d.branch_id) return;
      deptCount[d.branch_id] = (deptCount[d.branch_id] ?? 0) + 1;
    });
    const schedCount: Record<string, number> = {};
    (schedRes.data ?? []).forEach((s: any) => {
      if (!s.branch_id) return;
      if (s.status === "approved" && s.published_at) {
        schedCount[s.branch_id] = (schedCount[s.branch_id] ?? 0) + 1;
      }
    });
    const mgrMap: Record<string, string> = {};
    ((mgrRes as any).data ?? []).forEach((m: any) => {
      mgrMap[m.id] = m.full_name;
    });

    return (branches ?? []).map((b: any) => ({
      ...b,
      manager_name: b.manager_id ? mgrMap[b.manager_id] ?? null : null,
      employees_count: empCount[b.id] ?? 0,
      departments_count: deptCount[b.id] ?? 0,
      active_schedules_count: schedCount[b.id] ?? 0,
    }));
  });

export const listEmployeesForManagerPicker = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id,full_name,is_active")
      .eq("is_active", true)
      .order("full_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(40),
  address: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  is_active: z.boolean().optional(),
  copy_departments_from_branch_id: z.string().uuid().optional().nullable(),
});

export const createBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const supabase = context.supabase;

    const { data: existing } = await supabase
      .from("branches")
      .select("id")
      .eq("code", data.code)
      .maybeSingle();
    if (existing) throw new Error("קוד סניף כבר קיים במערכת");

    const { data: inserted, error } = await supabase
      .from("branches")
      .insert({
        name: data.name,
        code: data.code,
        address: data.address ?? null,
        phone: data.phone ?? null,
        is_active: data.is_active ?? true,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    if (data.copy_departments_from_branch_id) {
      const { data: srcDepts, error: dErr } = await supabase
        .from("departments")
        .select("name,code,is_active")
        .eq("branch_id", data.copy_departments_from_branch_id);
      if (dErr) throw new Error(dErr.message);
      if (srcDepts && srcDepts.length) {
        const suffix = Math.random().toString(36).slice(2, 6);
        const rows = srcDepts.map((d: any) => ({
          name: d.name,
          code: `${d.code}_${suffix}`,
          is_active: d.is_active,
          branch_id: inserted.id,
          manager_id: null,
        }));
        const { error: iErr } = await supabase.from("departments").insert(rows);
        if (iErr) throw new Error(iErr.message);
      }
    }

    return { ok: true, id: inserted.id };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  code: z.string().trim().min(1).max(40),
  address: z.string().trim().max(200).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  is_active: z.boolean(),
});

export const updateBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const { data: existing } = await context.supabase
      .from("branches")
      .select("id")
      .eq("code", data.code)
      .neq("id", data.id)
      .maybeSingle();
    if (existing) throw new Error("קוד סניף כבר קיים במערכת");
    const { error } = await context.supabase
      .from("branches")
      .update({
        name: data.name,
        code: data.code,
        address: data.address ?? null,
        phone: data.phone ?? null,
        is_active: data.is_active,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const assignSchema = z.object({
  branch_id: z.string().uuid(),
  manager_id: z.string().uuid().nullable(),
});

export const assignBranchManager = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => assignSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    if (data.manager_id) {
      const { data: other } = await context.supabase
        .from("branches")
        .select("id,name")
        .eq("manager_id", data.manager_id)
        .neq("id", data.branch_id)
        .maybeSingle();
      if (other) throw new Error(`העובד כבר משמש כמנהל סניף "${(other as any).name}"`);
    }
    const { error } = await context.supabase
      .from("branches")
      .update({ manager_id: data.manager_id })
      .eq("id", data.branch_id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const supabase = context.supabase;

    const checks: { table: string; label: string }[] = [
      { table: "profiles", label: "עובדים" },
      { table: "departments", label: "מחלקות" },
      { table: "schedules", label: "סידורי עבודה" },
      { table: "tasks", label: "משימות" },
    ];
    const blockers: string[] = [];
    for (const c of checks) {
      const { count, error } = await supabase
        .from(c.table)
        .select("id", { count: "exact", head: true })
        .eq("branch_id", data.id);
      if (error) throw new Error(error.message);
      if ((count ?? 0) > 0) blockers.push(`${c.label} (${count})`);
    }
    if (blockers.length) {
      throw new Error(`לא ניתן למחוק את הסניף. קיימים: ${blockers.join(", ")}`);
    }

    const { error } = await supabase.from("branches").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
