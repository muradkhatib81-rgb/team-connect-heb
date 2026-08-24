/**
 * Operational Errors — isolated feature.
 * Does NOT read/write user_roles or user_task_permissions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unauthorized");
}

export type OpsErrorCapabilities = {
  enabled: boolean;
  can_log: boolean;
  can_view_log: boolean;
  can_delete: boolean;
  is_dept_head: boolean;
  is_platform_owner: boolean;
  month_count: number;
  year_month: string;
  show_card: boolean;
};

export type OpsErrorType = {
  id: string;
  name_he: string;
  name_ar: string | null;
  name_en: string | null;
  is_active: boolean;
  sort_order: number;
};

export type OpsErrorEntry = {
  id: string;
  branch_id: string;
  department_id: string;
  employee_id: string | null;
  error_type_id: string;
  note: string | null;
  image_path: string | null;
  year_month: string;
  year_num: number;
  created_by: string;
  created_at: string;
  department_name?: string | null;
  employee_name?: string | null;
  type_name_he?: string | null;
  type_name_ar?: string | null;
  type_name_en?: string | null;
  creator_name?: string | null;
  image_url?: string | null;
};

export const getOpsErrorCapabilities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<OpsErrorCapabilities> => {
    const { supabase } = context as { supabase: any };
    const { data: caps, error } = await supabase.rpc("get_ops_error_my_capabilities", {
      _branch_id: data.branchId,
    });
    if (error) {
      if (/does not exist|function/i.test(error.message)) {
        return {
          enabled: false,
          can_log: false,
          can_view_log: false,
          can_delete: false,
          is_dept_head: false,
          is_platform_owner: false,
          month_count: 0,
          year_month: "",
          show_card: false,
        };
      }
      throw new Error(error.message);
    }
    const c = (caps ?? {}) as Record<string, unknown>;
    return {
      enabled: !!c.enabled,
      can_log: !!c.can_log,
      can_view_log: !!c.can_view_log,
      can_delete: !!c.can_delete,
      is_dept_head: !!c.is_dept_head,
      is_platform_owner: !!c.is_platform_owner,
      month_count: Number(c.month_count ?? 0),
      year_month: String(c.year_month ?? ""),
      show_card: !!c.show_card,
    };
  });

export const listOpsErrorTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpsErrorType[]> => {
    const { supabase } = context as { supabase: any };
    const { data: rows, error } = await supabase
      .from("ops_error_types")
      .select("id, name_he, name_ar, name_en, is_active, sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("name_he", { ascending: true });
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return (rows ?? []) as OpsErrorType[];
  });

export const listAllOpsErrorTypes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OpsErrorType[]> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { data: rows, error } = await supabase
      .from("ops_error_types")
      .select("id, name_he, name_ar, name_en, is_active, sort_order")
      .order("sort_order", { ascending: true })
      .order("name_he", { ascending: true });
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return (rows ?? []) as OpsErrorType[];
  });

export const upsertOpsErrorType = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid().optional(),
      name_he: z.string().trim().min(1).max(120),
      name_ar: z.string().trim().max(120).nullable().optional(),
      name_en: z.string().trim().max(120).nullable().optional(),
      is_active: z.boolean().optional(),
      sort_order: z.number().int().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const payload = {
      name_he: data.name_he,
      name_ar: data.name_ar ?? null,
      name_en: data.name_en ?? null,
      is_active: data.is_active ?? true,
      sort_order: data.sort_order ?? 100,
      updated_at: new Date().toISOString(),
      ...(data.id ? {} : { created_by: userId }),
    };
    if (data.id) {
      const { error } = await supabase.from("ops_error_types").update(payload).eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: row, error } = await supabase
      .from("ops_error_types")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id as string };
  });

export const listOpsErrorFeatureScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { data, error } = await supabase
      .from("ops_error_feature_scopes")
      .select("id, company_id, branch_id, enabled, created_at")
      .order("created_at", { ascending: false });
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return data ?? [];
  });

export const upsertOpsErrorFeatureScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      scopeType: z.enum(["company", "branch"]),
      scopeId: z.string().uuid(),
      enabled: z.boolean().default(true),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const row =
      data.scopeType === "company"
        ? { company_id: data.scopeId, branch_id: null, enabled: data.enabled, granted_by: userId }
        : { company_id: null, branch_id: data.scopeId, enabled: data.enabled, granted_by: userId };

    if (data.scopeType === "company") {
      await supabase.from("ops_error_feature_scopes").delete().eq("company_id", data.scopeId);
    } else {
      await supabase.from("ops_error_feature_scopes").delete().eq("branch_id", data.scopeId);
    }
    const { error: insErr } = await supabase.from("ops_error_feature_scopes").insert(row);
    if (insErr) throw new Error(insErr.message);
    return { ok: true };
  });

export const deleteOpsErrorFeatureScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { error } = await supabase.from("ops_error_feature_scopes").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOpsErrorUserGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid().optional() }).optional())
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    let q = supabase
      .from("ops_error_user_grants")
      .select("id, user_id, branch_id, can_log, can_view_log, can_delete, created_at")
      .order("created_at", { ascending: false });
    if (data?.branchId) q = q.eq("branch_id", data.branchId);
    const { data: rows, error } = await q;
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return rows ?? [];
  });

export const upsertOpsErrorUserGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      userId: z.string().uuid(),
      branchId: z.string().uuid(),
      can_log: z.boolean(),
      can_view_log: z.boolean(),
      can_delete: z.boolean(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    if (!data.can_log && !data.can_view_log && !data.can_delete) {
      const { error } = await supabase
        .from("ops_error_user_grants")
        .delete()
        .eq("user_id", data.userId)
        .eq("branch_id", data.branchId);
      if (error) throw new Error(error.message);
      return { ok: true, removed: true };
    }
    const { error } = await supabase.from("ops_error_user_grants").upsert(
      {
        user_id: data.userId,
        branch_id: data.branchId,
        can_log: data.can_log,
        can_view_log: data.can_view_log,
        can_delete: data.can_delete,
        granted_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,branch_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listOpsErrorEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/).optional(),
      yearNum: z.number().int().optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<OpsErrorEntry[]> => {
    const { supabase } = context as { supabase: any };
    let q = supabase
      .from("ops_error_entries")
      .select(
        "id, branch_id, department_id, employee_id, error_type_id, note, image_path, year_month, year_num, created_by, created_at",
      )
      .eq("branch_id", data.branchId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (data.yearMonth) q = q.eq("year_month", data.yearMonth);
    if (data.yearNum) q = q.eq("year_num", data.yearNum);
    const { data: rows, error } = await q;
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    const entries = (rows ?? []) as OpsErrorEntry[];
    if (!entries.length) return [];

    const deptIds = [...new Set(entries.map((e) => e.department_id))];
    const empIds = [...new Set(entries.map((e) => e.employee_id).filter(Boolean))] as string[];
    const typeIds = [...new Set(entries.map((e) => e.error_type_id))];
    const creatorIds = [...new Set(entries.map((e) => e.created_by))];

    const [depts, emps, types, creators] = await Promise.all([
      supabase.from("departments").select("id, name").in("id", deptIds),
      empIds.length
        ? supabase.from("profiles").select("id, full_name").in("id", empIds)
        : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      supabase.from("ops_error_types").select("id, name_he, name_ar, name_en").in("id", typeIds),
      supabase.from("profiles").select("id, full_name").in("id", creatorIds),
    ]);

    const deptMap = new Map((depts.data ?? []).map((d: { id: string; name: string }) => [d.id, d.name]));
    const empMap = new Map(
      ((emps as { data?: { id: string; full_name: string | null }[] }).data ?? []).map((p) => [
        p.id,
        p.full_name,
      ]),
    );
    const typeMap = new Map(
      (types.data ?? []).map(
        (t: { id: string; name_he: string; name_ar: string | null; name_en: string | null }) => [
          t.id,
          t,
        ],
      ),
    );
    const creatorMap = new Map(
      (creators.data ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]),
    );

    const withMeta = entries.map((e) => {
      const ty = typeMap.get(e.error_type_id) as
        | { name_he: string; name_ar: string | null; name_en: string | null }
        | undefined;
      return {
        ...e,
        department_name: deptMap.get(e.department_id) ?? null,
        employee_name: e.employee_id ? empMap.get(e.employee_id) ?? null : null,
        type_name_he: ty?.name_he ?? null,
        type_name_ar: ty?.name_ar ?? null,
        type_name_en: ty?.name_en ?? null,
        creator_name: creatorMap.get(e.created_by) ?? null,
        image_url: null as string | null,
      };
    });

    await Promise.all(
      withMeta.map(async (e) => {
        if (!e.image_path) return;
        const { data: signed } = await supabase.storage
          .from("ops-error-images")
          .createSignedUrl(e.image_path, 60 * 60);
        e.image_url = signed?.signedUrl ?? null;
      }),
    );

    return withMeta;
  });

export const createOpsErrorEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      departmentId: z.string().uuid(),
      employeeId: z.string().uuid().nullable().optional(),
      errorTypeId: z.string().uuid(),
      note: z.string().trim().max(1000).nullable().optional(),
      imagePath: z.string().trim().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: id, error } = await supabase.rpc("create_ops_error_entry", {
      _branch_id: data.branchId,
      _department_id: data.departmentId,
      _employee_id: data.employeeId ?? null,
      _error_type_id: data.errorTypeId,
      _note: data.note ?? null,
      _image_path: data.imagePath ?? null,
    });
    if (error) throw new Error(error.message);
    return { id: id as string };
  });

export const deleteOpsErrorEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: imagePath, error } = await supabase.rpc("delete_ops_error_entry", {
      _id: data.id,
    });
    if (error) throw new Error(error.message);
    if (imagePath) {
      try {
        await supabase.storage.from("ops-error-images").remove([imagePath as string]);
      } catch {
        /* non-fatal */
      }
    }
    return { ok: true };
  });

export const summarizeOpsErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      branchId: z.string().uuid(),
      yearMonth: z.string().regex(/^\d{4}-\d{2}$/).nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: summary, error } = await supabase.rpc("summarize_ops_errors_for_branch", {
      _branch_id: data.branchId,
      _year_month: data.yearMonth ?? null,
    });
    if (error) {
      if (/does not exist|function/i.test(error.message)) {
        return { enabled: false, total: 0 };
      }
      throw new Error(error.message);
    }
    return summary ?? { enabled: false, total: 0 };
  });

export const listBranchDepartmentsForErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: rows, error } = await supabase
      .from("departments")
      .select("id, name, manager_id, is_active")
      .eq("branch_id", data.branchId)
      .eq("is_active", true)
      .order("name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listDepartmentEmployeesForErrors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ departmentId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase } = context as { supabase: any };
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, full_name, is_active")
      .eq("department_id", data.departmentId)
      .eq("is_active", true)
      .order("full_name");
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

export const listBranchProfilesForErrorGrants = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ branchId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const { data: rows, error } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, is_active")
      .eq("branch_id", data.branchId)
      .eq("is_active", true)
      .order("full_name")
      .limit(500);
    if (error) throw new Error(error.message);
    return rows ?? [];
  });
