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
  .middleware([requireSupabaseAuth])
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
  .middleware([requireSupabaseAuth])
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

