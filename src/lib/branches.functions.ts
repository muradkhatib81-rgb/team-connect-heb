import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

/** Platform Owner gate: main_admin OR system_admin (matches branches RLS). */
async function assertSystemAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["system_admin", "main_admin"]);
  if (error || !data?.length) {
    throw new Error("רק בעל המערכת הראשי יכול לבצע פעולה זו");
  }
}

/**
 * Build a Supabase client that carries the caller's bearer token but
 * intentionally OMITS the X-Active-Branch header. This bypasses the
 * `branch_scope_restriction` RESTRICTIVE policies on branch-scoped tables
 * (departments, profiles, schedules, ...) so system-admin cross-branch
 * operations — listing counts for every branch, copying departments from
 * a source branch different from the current active branch — return the
 * full data set instead of being clipped to the active branch.
 */
function createUnscopedClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  const auth = getRequest()?.headers.get("authorization") ?? "";
  return createClient<Database>(url, key, {
    global: { headers: auth ? { Authorization: auth } : {} },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export const listBranchesWithStats = createServerFn({ method: "GET" })
  .middleware([requireBranchContext])
  .handler(async ({ context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    // Use an UNSCOPED client so per-branch counts are not clipped by the
    // caller's active branch (RLS `branch_scope_restriction` would otherwise
    // return 0 for every branch except the active one).
    const supabase = createUnscopedClient();

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
  .middleware([requireBranchContext])
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
  /**
   * Platform company display name. Stored on `company_settings.company_name`
   * for the new branch — never the branch name. Required to override the
   * legacy DB default that reused a store/branch string.
   */
  company_name: z.string().trim().max(200).optional().nullable(),
});

/**
 * Ensure the new branch has its own company_settings row whose
 * `company_name` is the Platform company name (not `branches.name`).
 * Always passes company_name explicitly so the legacy column DEFAULT
 * ('רמי לוי שער בנימין') cannot leak into new branches.
 */
async function seedCompanySettingsForBranch(
  supabase: ReturnType<typeof createUnscopedClient>,
  branchId: string,
  companyName: string | null | undefined,
) {
  const name = (companyName ?? "").trim();
  const { data: existing } = await supabase
    .from("company_settings")
    .select("id")
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .maybeSingle();
  if (existing?.id) {
    if (name) {
      const { error } = await supabase
        .from("company_settings")
        .update({ company_name: name })
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    }
    return;
  }
  const { error } = await supabase.from("company_settings").insert({
    branch_id: branchId,
    company_name: name,
    is_active: true,
  });
  if (error) throw new Error(error.message);
}

const syncCompanyNameSchema = z.object({
  branch_id: z.string().uuid(),
  company_name: z.string().trim().min(1).max(200),
});

/** Upsert `company_settings.company_name` for an existing real branch (e.g. after Platform assign). */
export const syncBranchCompanyName = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => syncCompanyNameSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    const supabase = createUnscopedClient();
    await seedCompanySettingsForBranch(supabase, data.branch_id, data.company_name);
    return { ok: true };
  });

export const createBranch = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertSystemAdmin(context.supabase, context.userId);
    // Cross-branch admin flow: read from any source branch and insert into
    // the newly created branch. Use an unscoped client so RLS doesn't clip
    // reads to the caller's active branch.
    const supabase = createUnscopedClient();

    const { data: existing } = await supabase
      .from("branches")
      .select("id")
      .eq("code", data.code)
      .maybeSingle();
    if (existing) throw new Error("קוד סניף כבר קיים במערכת");

    // Prefer a direct insert (RLS allows main_admin). The RPC
    // create_branch_with_departments requires system_admin only, which the
    // bootstrapped Platform Owner may not hold yet — so copy departments here.
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

    let departmentsCopied = 0;
    const sourceId = data.copy_departments_from_branch_id;
    if (sourceId) {
      const { data: sourceDepts, error: srcErr } = await supabase
        .from("departments")
        .select("name, code, is_active")
        .eq("branch_id", sourceId)
        .order("created_at", { ascending: true });
      if (srcErr) throw new Error(srcErr.message);
      if (!sourceDepts?.length) {
        throw new Error("לסניף המקור אין מחלקות להעתקה");
      }
      const suffix = Math.random().toString(16).slice(2, 6);
      const rows = sourceDepts.map((d: { name: string; code: string; is_active: boolean }) => ({
        name: d.name,
        code: `${d.code}_${suffix}`,
        is_active: d.is_active,
        branch_id: inserted.id,
        manager_id: null,
      }));
      const { error: copyErr } = await supabase.from("departments").insert(rows);
      if (copyErr) throw new Error(copyErr.message);
      departmentsCopied = rows.length;
    }

    await seedCompanySettingsForBranch(supabase, inserted.id, data.company_name);
    return { ok: true, id: inserted.id, departments_copied: departmentsCopied };
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
  .middleware([requireBranchContext])
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
  .middleware([requireBranchContext])
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
const deleteCascadeSchema = z.object({
  id: z.string().uuid(),
  confirm_cascade: z.literal(true).optional(),
});

export type BranchBlockerCounts = {
  employees: number;
  departments: number;
  schedules: number;
  tasks: number;
  messages: number;
  notifications: number;
  reports: number;
};

export type BranchBlockerResult = {
  ok: boolean;
  canDelete: boolean;
  onlyDepartments: boolean;
  isEmpty: boolean;
  employees: number;
  departments: number;
  schedules: number;
  tasks: number;
  messages: number;
  notifications: number;
  reports: number;
  error?: string;
};

const ZERO_COUNTS = {
  employees: 0,
  departments: 0,
  schedules: 0,
  tasks: 0,
  messages: 0,
  notifications: 0,
  reports: 0,
};

function normalizeBlockers(b: any): Omit<BranchBlockerResult, "ok" | "error"> {
  const c = {
    employees: Number(b?.employees ?? 0),
    departments: Number(b?.departments ?? 0),
    schedules: Number(b?.schedules ?? 0),
    tasks: Number(b?.tasks ?? 0),
    messages: Number(b?.messages ?? 0),
    notifications: Number(b?.notifications ?? 0),
    reports: Number(b?.reports ?? 0),
  };
  const operational =
    c.employees + c.schedules + c.tasks + c.messages + c.notifications + c.reports;
  return {
    ...c,
    canDelete: operational === 0,
    onlyDepartments: operational === 0 && c.departments > 0,
    isEmpty: operational === 0 && c.departments === 0,
  };
}

export const getBranchDeleteBlockers = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }): Promise<BranchBlockerResult> => {
    try {
      await assertSystemAdmin(context.supabase, context.userId);
    } catch {
      return {
        ok: false,
        ...ZERO_COUNTS,
        canDelete: false,
        onlyDepartments: false,
        isEmpty: false,
        error: "אין לך הרשאה לבצע פעולה זו.",
      };
    }
    try {
      const { data: b, error } = await (context.supabase as any).rpc(
        "get_branch_delete_blockers",
        { _branch_id: data.id },
      );
      if (error) {
        console.error("[getBranchDeleteBlockers] rpc error:", error);
        return {
          ok: false,
          ...ZERO_COUNTS,
          canDelete: false,
          onlyDepartments: false,
          isEmpty: false,
          error: "אירעה שגיאה בבדיקת הנתונים המקושרים לסניף.",
        };
      }
      return { ok: true, ...normalizeBlockers(b) };
    } catch (err) {
      console.error("[getBranchDeleteBlockers] threw:", err);
      return {
        ok: false,
        ...ZERO_COUNTS,
        canDelete: false,
        onlyDepartments: false,
        isEmpty: false,
        error: "אירעה שגיאה בבדיקת הנתונים המקושרים לסניף.",
      };
    }
  });

export type BranchDeleteResult = {
  ok: boolean;
  deleted: boolean;
  canDelete: boolean;
  onlyDepartments: boolean;
  isEmpty: boolean;
  departmentsDeleted: number;
  employees: number;
  departments: number;
  schedules: number;
  tasks: number;
  messages: number;
  notifications: number;
  reports: number;
  message?: string;
};

function buildBlockerMessage(c: BranchBlockerCounts): string {
  const lines = [
    `• עובדים: ${c.employees}`,
    `• סידורי עבודה: ${c.schedules}`,
    `• דוחות: ${c.reports}`,
    `• משימות: ${c.tasks}`,
    `• הודעות: ${c.messages}`,
    `• התראות: ${c.notifications}`,
  ];
  return `לא ניתן למחוק את הסניף. קיימים נתונים תפעוליים:\n${lines.join("\n")}`;
}

export const deleteBranch = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => deleteCascadeSchema.parse(data))
  .handler(async ({ data, context }): Promise<BranchDeleteResult> => {
    const empty: BranchDeleteResult = {
      ok: false,
      deleted: false,
      canDelete: false,
      onlyDepartments: false,
      isEmpty: false,
      departmentsDeleted: 0,
      ...ZERO_COUNTS,
    };
    try {
      await assertSystemAdmin(context.supabase, context.userId);
    } catch (err: any) {
      console.error("[deleteBranch] auth check failed:", err);
      return { ...empty, message: "אין לך הרשאה למחוק סניפים." };
    }
    const supabase = context.supabase;

    let blockers: Omit<BranchBlockerResult, "ok" | "error">;
    try {
      const { data: b, error } = await (supabase as any).rpc(
        "get_branch_delete_blockers",
        { _branch_id: data.id },
      );
      if (error) {
        console.error("[deleteBranch] blocker rpc error:", error);
        return {
          ...empty,
          message: "אירעה שגיאה בבדיקת הנתונים המקושרים לסניף.",
        };
      }
      blockers = normalizeBlockers(b);
    } catch (err) {
      console.error("[deleteBranch] blocker rpc threw:", err);
      return {
        ...empty,
        message: "אירעה שגיאה בבדיקת הנתונים המקושרים לסניף.",
      };
    }

    // Block if any operational data remains
    if (!blockers.canDelete) {
      return {
        ok: false,
        deleted: false,
        departmentsDeleted: 0,
        ...blockers,
        message: buildBlockerMessage(blockers),
      };
    }

    // Branch has departments → require explicit cascade confirmation
    if (blockers.onlyDepartments && !data.confirm_cascade) {
      return {
        ok: true,
        deleted: false,
        departmentsDeleted: 0,
        ...blockers,
        message: `הסניף מכיל ${blockers.departments} מחלקות. נדרש אישור למחיקת הסניף יחד עם המחלקות.`,
      };
    }

    // Cascade (or simple) delete via SECURITY DEFINER RPC
    try {
      const { data: res, error } = await (supabase as any).rpc(
        "delete_branch_cascade",
        { _branch_id: data.id },
      );
      if (error) {
        console.error("[deleteBranch] cascade rpc error:", error);
        return {
          ...empty,
          ...blockers,
          message: "אירעה שגיאה במחיקת הסניף. נסה שוב מאוחר יותר.",
        };
      }
      if (!res?.deleted) {
        const b2 = normalizeBlockers(res?.blockers);
        return {
          ok: false,
          deleted: false,
          departmentsDeleted: 0,
          ...b2,
          message: buildBlockerMessage(b2),
        };
      }
      return {
        ok: true,
        deleted: true,
        canDelete: true,
        onlyDepartments: blockers.onlyDepartments,
        isEmpty: blockers.isEmpty,
        departmentsDeleted: Number(res?.departments_deleted ?? blockers.departments),
        ...ZERO_COUNTS,
        departments: blockers.departments,
      };
    } catch (err) {
      console.error("[deleteBranch] cascade rpc threw:", err);
      return {
        ...empty,
        ...blockers,
        message: "אירעה שגיאה במחיקת הסניף. נסה שוב מאוחר יותר.",
      };
    }
  });

