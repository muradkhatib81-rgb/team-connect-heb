import { createServerFn } from "@tanstack/react-start";
import { requireBranchContext } from "@/integrations/supabase/active-branch.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import i18n from "@/i18n";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

const EMPLOYEE_EMAIL_DOMAIN = "employees.ramilevy.local";
const idEmail = (idNumber: string) => `${idNumber.trim()}@${EMPLOYEE_EMAIL_DOMAIN}`;

type AdminClient = SupabaseClient<Database>;

function formatAuthError(error: { message?: string; code?: string } | null): string {
  const raw = error?.message?.trim();
  if (raw && raw !== "{}" && raw !== "undefined") return raw;
  if (error?.code === "email_exists") return i18n.t("serverErrors.common.duplicateIdNumber");
  return i18n.t("serverErrors.common.authAccountError");
}

async function findAuthUserIdByEmail(supabaseAdmin: AdminClient, email: string): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;
  while (page <= 20) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(formatAuthError(error));
    const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === normalized);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

/** Rebuild used/reserved from open leave_requests — source of truth after cancel. */
async function reconcileLeaveBalanceCounters(
  supabaseAdmin: AdminClient,
  userId: string,
): Promise<void> {
  const [{ data: balances }, { data: requests }] = await Promise.all([
    supabaseAdmin
      .from("leave_balances")
      .select("leave_type_id")
      .eq("user_id", userId),
    supabaseAdmin
      .from("leave_requests")
      .select("leave_type_id, days_count, kind, status")
      .eq("user_id", userId)
      .in("kind", ["leave", "extension"]),
  ]);

  const usedByType = new Map<string, number>();
  const reservedByType = new Map<string, number>();
  for (const row of requests ?? []) {
    const r = row as {
      leave_type_id: string;
      days_count: number;
      kind: string;
      status: string;
    };
    const days = Number(r.days_count ?? 0);
    if (r.status === "approved") {
      usedByType.set(r.leave_type_id, (usedByType.get(r.leave_type_id) ?? 0) + days);
    } else if (r.status === "pending_dept" || r.status === "pending_admin") {
      reservedByType.set(
        r.leave_type_id,
        (reservedByType.get(r.leave_type_id) ?? 0) + days,
      );
    }
  }

  const nowIso = new Date().toISOString();
  for (const bal of balances ?? []) {
    const typeId = (bal as { leave_type_id: string }).leave_type_id;
    await supabaseAdmin
      .from("leave_balances")
      .update({
        used_days: usedByType.get(typeId) ?? 0,
        reserved_days: reservedByType.get(typeId) ?? 0,
        updated_at: nowIso,
      })
      .eq("user_id", userId)
      .eq("leave_type_id", typeId);
  }
}

/** Keep Supabase Auth login (email = id_number@domain) in sync with profile id_number changes. */
async function syncEmployeeAuthIdentity(
  supabaseAdmin: AdminClient,
  opts: {
    userId: string;
    idNumber: string;
    firstName: string;
    lastName: string;
  },
) {
  const { error } = await (supabaseAdmin as any).rpc("sync_profile_auth_email", {
    _user_id: opts.userId,
    _id_number: opts.idNumber,
    _first_name: opts.firstName,
    _last_name: opts.lastName,
  });
  if (error) throw new Error(error.message || formatAuthError(error));
}

async function assertIdNumberAvailableInBranch(
  supabase: any,
  idNumber: string,
  branchId: string,
  excludeUserId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id_number", idNumber)
    .eq("branch_id", branchId)
    .neq("id", excludeUserId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) throw new Error(i18n.t("serverErrors.common.duplicateIdNumber"));
}

/**
 * When profile was archived but auth.users remained (delete blocked by FK/triggers),
 * reuse the existing auth row and insert a fresh profile instead of delete+create.
 */
async function reprovisionOrphanEmployeeAuth(
  supabaseAdmin: AdminClient,
  data: CreateEmployeeInput,
  branchId: string,
): Promise<string | null> {
  const email = idEmail(data.id_number);
  const uid = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (!uid) return null;

  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (prof) return null;

  const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(uid, {
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.first_name,
      last_name: data.last_name,
      id_number: data.id_number,
      department_id: data.department_id,
      job_title: data.job_title,
      phone: data.phone,
      role: data.role,
    },
  });
  if (updErr) throw new Error(formatAuthError(updErr));

  const fullName = `${data.first_name.trim()} ${data.last_name.trim()}`.trim();
  const { error: profErr } = await supabaseAdmin.from("profiles").insert({
    id: uid,
    first_name: data.first_name.trim(),
    last_name: data.last_name.trim(),
    full_name: fullName,
    id_number: data.id_number,
    department_id: data.department_id,
    branch_id: branchId,
    job_title: data.job_title || null,
    phone: data.phone || null,
    avatar_url: data.avatar_url ?? null,
    must_change_password: true,
    is_active: true,
  });
  if (profErr) throw new Error(profErr.message);

  await supabaseAdmin.from("user_roles").delete().eq("user_id", uid);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: uid, role: data.role });
  if (roleErr) throw new Error(roleErr.message);

  if (data.role === "department_manager") {
    const { error: mgrErr } = await supabaseAdmin
      .from("departments")
      .update({ manager_id: uid })
      .eq("id", data.department_id)
      .eq("branch_id", branchId);
    if (mgrErr) throw new Error(mgrErr.message);
  }

  await supabaseAdmin.rpc("sync_user_task_permissions", { _user_id: uid });

  return uid;
}

/** Best-effort auth cleanup after archive; non-fatal when FK triggers block delete. */
async function cleanupOrphanEmployeeAuth(supabaseAdmin: AdminClient, idNumber: string) {
  const email = idEmail(idNumber);
  const uid = await findAuthUserIdByEmail(supabaseAdmin, email);
  if (!uid) return;
  const { data: prof } = await supabaseAdmin.from("profiles").select("id").eq("id", uid).maybeSingle();
  if (!prof) {
    const { error } = await supabaseAdmin.auth.admin.deleteUser(uid);
    if (error) {
      console.error(`[cleanupOrphanEmployeeAuth] deleteUser failed for ${uid}: ${formatAuthError(error)}`);
    }
  }
}

const ID_REGEX = /^\d{5,15}$/;

const APP_ROLES = [
  "main_admin",
  "branch_manager",
  "assistant_manager",
  "department_manager",
  "employee",
] as const;

type ManagedAppRole = (typeof APP_ROLES)[number];

const MANAGEMENT_ON_SHIFT_ROLES = new Set<ManagedAppRole | string>([
  "branch_manager",
  "assistant_manager",
]);

async function clearManagementOnShiftIfDemoted(
  supabaseAdmin: any,
  oldRoleSet: Set<string>,
  newRole: ManagedAppRole,
  targetUserId: string,
) {
  const wasManagerOnShift = [...oldRoleSet].some((r) => MANAGEMENT_ON_SHIFT_ROLES.has(r));
  if (!wasManagerOnShift || MANAGEMENT_ON_SHIFT_ROLES.has(newRole)) return;
  await supabaseAdmin.from("management_on_shift").delete().eq("user_id", targetUserId);
}

/**
 * Keep departments.manager_id aligned with a department_manager role.
 * Does not grant/revoke roles or permissions — only the department ownership link.
 */
async function ensureDepartmentManagerAssignment(
  supabaseAdmin: any,
  opts: { userId: string; departmentId: string; branchId: string },
) {
  const { error: clearErr } = await supabaseAdmin
    .from("departments")
    .update({ manager_id: null })
    .eq("manager_id", opts.userId)
    .eq("branch_id", opts.branchId)
    .neq("id", opts.departmentId);
  if (clearErr) throw new Error(clearErr.message);

  const { data: dept, error: deptErr } = await supabaseAdmin
    .from("departments")
    .select("id, manager_id")
    .eq("id", opts.departmentId)
    .eq("branch_id", opts.branchId)
    .maybeSingle();
  if (deptErr) throw new Error(deptErr.message);
  if (!dept) throw new Error(i18n.t("serverErrors.common.departmentNotInBranch"));

  if ((dept as { manager_id: string | null }).manager_id === opts.userId) return;

  if (
    (dept as { manager_id: string | null }).manager_id &&
    (dept as { manager_id: string | null }).manager_id !== opts.userId
  ) {
    throw new Error(i18n.t("serverErrors.common.deptHasManager"));
  }

  const { error: assignErr } = await supabaseAdmin
    .from("departments")
    .update({ manager_id: opts.userId })
    .eq("id", opts.departmentId)
    .eq("branch_id", opts.branchId);
  if (assignErr) throw new Error(assignErr.message);
}

async function applyUserRoleChange(
  supabase: any,
  supabaseAdmin: any,
  opts: {
    targetUserId: string;
    newRole: ManagedAppRole;
    departmentId: string | null;
    branchId: string;
    caps: Awaited<ReturnType<typeof getEmployeeManagerCaps>>;
  },
) {
  const { targetUserId, newRole, departmentId, branchId, caps } = opts;
  assertAssignableRole(newRole, caps);

  const { data: oldRoles, error: oldRolesErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", targetUserId);
  if (oldRolesErr) throw new Error(oldRolesErr.message);
  const oldRoleSet = new Set((oldRoles ?? []).map((r: any) => r.role as string));

  if (oldRoleSet.has("department_manager") && newRole !== "department_manager") {
    const { data: managedDepts, error: managedErr } = await supabaseAdmin
      .from("departments")
      .select("id")
      .eq("manager_id", targetUserId)
      .eq("branch_id", branchId);
    if (managedErr) throw new Error(managedErr.message);
    for (const dept of managedDepts ?? []) {
      const { error } = await supabase.rpc("set_department_manager", {
        _dept_id: dept.id,
        _new_manager_id: null,
      });
      if (error) throw new Error(error.message);
    }
  }

  if (newRole === "department_manager") {
    if (!departmentId) throw new Error(i18n.t("serverErrors.common.assignDeptBeforeHead"));
    await clearManagementOnShiftIfDemoted(supabaseAdmin, oldRoleSet, newRole, targetUserId);
    const { error } = await supabase.rpc("set_department_manager", {
      _dept_id: departmentId,
      _new_manager_id: targetUserId,
    });
    if (error) throw new Error(error.message);
    // RPC may early-return when manager_id already matches; still repair any
    // missing ownership link without changing roles/permissions further.
    await ensureDepartmentManagerAssignment(supabaseAdmin, {
      userId: targetUserId,
      departmentId,
      branchId,
    });
    const { error: syncErr } = await supabaseAdmin.rpc("sync_user_task_permissions", {
      _user_id: targetUserId,
    });
    if (syncErr) throw new Error(syncErr.message);
    return;
  }

  await clearManagementOnShiftIfDemoted(supabaseAdmin, oldRoleSet, newRole, targetUserId);

  await supabaseAdmin.from("user_roles").delete().eq("user_id", targetUserId);
  const { error: roleErr } = await supabaseAdmin
    .from("user_roles")
    .insert({ user_id: targetUserId, role: newRole });
  if (roleErr) throw new Error(roleErr.message);

  await supabaseAdmin
    .from("departments")
    .update({ manager_id: null })
    .eq("manager_id", targetUserId)
    .eq("branch_id", branchId);

  const { error: syncErr } = await supabaseAdmin.rpc("sync_user_task_permissions", {
    _user_id: targetUserId,
  });
  if (syncErr) throw new Error(syncErr.message);
}


const createEmployeeSchema = z.object({
  first_name: z.string().trim().min(1, i18n.t("serverErrors.common.firstNameRequired")).max(50),
  last_name: z.string().trim().min(1, i18n.t("serverErrors.common.lastNameRequired")).max(50),
  id_number: z.string().regex(ID_REGEX, i18n.t("serverErrors.common.invalidIdNumber")),
  department_id: z.string().uuid(i18n.t("serverErrors.common.departmentRequired")),
  job_title: z.string().trim().max(80).optional().default(""),
  phone: z.string().trim().max(20).optional().default(""),
  password: z.string().min(6).max(72),
  role: z.enum(APP_ROLES).default("employee"),
  avatar_url: z.string().trim().max(500).optional().nullable(),
});

async function getEmployeeManagerCaps(supabase: any, userId: string) {
  const [{ data: rolesRows, error }, { data: perm }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("user_task_permissions")
      .select("can_add_employee, can_edit_employee, can_delete_employee, can_reset_employee_password, can_manage_users")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (error) throw new Error(i18n.t("serverErrors.common.permissionError"));
  const roles = (rolesRows ?? []).map((r: any) => r.role as string);
  const isMainAdmin = roles.includes("main_admin");
  const isSystemAdmin = roles.includes("system_admin");
  const isPlatformOwner = isMainAdmin || isSystemAdmin;
  const isBranchManager = roles.includes("branch_manager");
  const isAssistantManager = roles.includes("assistant_manager");
  const p: any = perm ?? {};
  return {
    roles,
    isMainAdmin,
    isSystemAdmin,
    isPlatformOwner,
    isBranchManager,
    canAdd: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_add_employee),
    canEdit: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_edit_employee),
    canDelete: isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_delete_employee),
    canResetPassword:
      isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_reset_employee_password),
    canManageUsers:
      isPlatformOwner || isBranchManager || (isAssistantManager && !!p.can_manage_users),
  };
}

function assertAssignableRole(role: (typeof APP_ROLES)[number], caps: Awaited<ReturnType<typeof getEmployeeManagerCaps>>) {
  if (caps.isPlatformOwner) return;
  if (!caps.canManageUsers && role !== "employee") {
    throw new Error(i18n.t("serverErrors.common.noGrantMgmtRole"));
  }
  if (role === "main_admin" || role === "branch_manager") {
    throw new Error(i18n.t("serverErrors.common.branchMgrCannotGrant"));
  }
}

async function assertTargetIsNotProtectedManager(supabase: any, targetUserId: string, caps: Awaited<ReturnType<typeof getEmployeeManagerCaps>>) {
  if (caps.isPlatformOwner) return;
  const { data, error } = await supabase.rpc("list_visible_user_roles");
  if (error) throw new Error(error.message);
  const roles = (data ?? [])
    .filter((r: any) => r.user_id === targetUserId)
    .map((r: any) => r.role as string);
  if (roles.includes("main_admin") || roles.includes("branch_manager") || roles.includes("system_admin")) {
    throw new Error(i18n.t("serverErrors.common.onlyOwnerEditsOwners"));
  }
}

async function assertProfileVisibleInActiveBranch(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(i18n.t("serverErrors.common.employeeNotInBranch"));
}

const createEmployeeSchemaExt = createEmployeeSchema.extend({
  force_archived: z.boolean().optional().default(false),
});

type CreateEmployeeInput = z.infer<typeof createEmployeeSchemaExt>;

export const createEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => createEmployeeSchemaExt.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canAdd) throw new Error(i18n.t("serverErrors.common.noAddEmployee"));
    assertAssignableRole(data.role, caps);

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id, branch_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept) throw new Error(i18n.t("serverErrors.common.departmentNotFound"));

    const branchId = (dept as { branch_id: string }).branch_id;

    const { companyIdForPhysicalBranch, assertCanAddEmployee } = await import(
      "@/lib/billing-entitlements.server"
    );
    const companyId = await companyIdForPhysicalBranch(branchId);
    if (companyId) {
      await assertCanAddEmployee(companyId);
    }

    // Duplicate checks via the authenticated, branch-scoped client (RLS).
    const { data: existing, error: exErr } = await context.supabase
      .from("profiles")
      .select("id, first_name, last_name, full_name, is_active, job_title, department_id, on_leave, departments(name)")
      .eq("id_number", data.id_number)
      .eq("branch_id", branchId)
      .maybeSingle();
    if (exErr) throw new Error(exErr.message);
    if (existing) {
      const payload = {
        id: existing.id,
        name: [existing.first_name, existing.last_name].filter(Boolean).join(" ") || existing.full_name || "",
        job_title: existing.job_title ?? "",
        department_id: existing.department_id ?? null,
        department_name: (existing as { departments?: { name?: string } }).departments?.name ?? null,
        is_active: existing.is_active !== false,
        on_leave: !!(existing as { on_leave?: boolean }).on_leave,
      };
      throw new Error(`DUPLICATE_EMPLOYEE::${JSON.stringify(payload)}`);
    }

    if (!data.force_archived) {
      const { data: archRows, error: aErr } = await context.supabase.rpc(
        "find_archived_by_id_number",
        { _id_number: data.id_number },
      );
      if (aErr) throw new Error(aErr.message);
      const arch = (archRows as unknown[] | null)?.[0] ?? null;
      if (arch) {
        throw new Error(`ARCHIVED_EXISTS::${JSON.stringify(arch)}`);
      }
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const reprovisionedId = await reprovisionOrphanEmployeeAuth(supabaseAdmin, data, branchId);
    if (reprovisionedId) {
      return { id: reprovisionedId };
    }

    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email: idEmail(data.id_number),
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        id_number: data.id_number,
        department_id: data.department_id,
        job_title: data.job_title,
        phone: data.phone,
        role: data.role,
      },
    });
    if (error) {
      const msg = formatAuthError(error).toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists") || msg.includes("duplicate")) {
        const fallbackId = await reprovisionOrphanEmployeeAuth(supabaseAdmin, data, branchId);
        if (fallbackId) return { id: fallbackId };
        throw new Error(i18n.t("serverErrors.common.duplicateIdNumber"));
      }
      throw new Error(formatAuthError(error) || i18n.t("serverErrors.common.createEmployeeError"));
    }

    const newUserId = created.user?.id ?? null;
    if (newUserId) {
      await supabaseAdmin
        .from("profiles")
        .update({
          department_id: data.department_id,
          branch_id: branchId,
          avatar_url: data.avatar_url ?? null,
        })
        .eq("id", newUserId);

      await applyUserRoleChange(context.supabase, supabaseAdmin, {
        targetUserId: newUserId,
        newRole: data.role,
        departmentId: data.department_id,
        branchId,
        caps,
      });
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
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canDelete) throw new Error(i18n.t("serverErrors.common.noDeleteEmployee"));
    if (data.user_id === context.userId) {
      throw new Error(i18n.t("serverErrors.common.cannotDeleteSelf"));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);

    const { data: profileRow } = await supabaseAdmin
      .from("profiles")
      .select("id_number")
      .eq("id", data.user_id)
      .maybeSingle();

    // Archive snapshot + cleanup (RPC enforces branch and role authorization)
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

    // Delete auth user (profile + roles were already removed by the RPC)
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) {
      if (profileRow?.id_number) {
        await cleanupOrphanEmployeeAuth(supabaseAdmin, profileRow.id_number);
      } else {
        throw new Error(
          error.message ||
            i18n.t("serverErrors.common.archiveAuthFailed"),
        );
      }
    }

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
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canResetPassword) throw new Error(i18n.t("serverErrors.common.noResetPassword"));
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);
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

const updateEmployeeSchema = z.object({
  user_id: z.string().uuid(),
  first_name: z.string().trim().min(1, i18n.t("serverErrors.common.firstNameRequired")).max(50),
  last_name: z.string().trim().min(1, i18n.t("serverErrors.common.lastNameRequired")).max(50),
  id_number: z.string().regex(ID_REGEX, i18n.t("serverErrors.common.invalidIdNumber")).nullable().optional(),
  department_id: z.string().uuid(i18n.t("serverErrors.common.departmentRequired")),
  phone: z.string().trim().max(20).optional().default(""),
  job_title: z.string().trim().max(80).optional().default(""),
  on_leave: z.boolean(),
  leave_start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leave_end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  leave_type_code: z.enum(["regular", "sick"]).nullable().optional(),
  is_active: z.boolean(),
  is_active_changed: z.boolean(),
  avatar_url: z.string().trim().max(500).nullable().optional(),
  role: z.enum(APP_ROLES).optional(),
  role_changed: z.boolean().optional().default(false),
});

const changeUserRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(APP_ROLES),
});

export const changeUserRole = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => changeUserRoleSchema.parse(data))
  .handler(async ({ data, context }) => {
    if (!context.branchId) throw new Error(i18n.t("serverErrors.common.selectBranch"));
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canManageUsers) {
      throw new Error(i18n.t("serverErrors.common.noChangeRole"));
    }
    if (data.user_id === context.userId) {
      throw new Error(i18n.t("serverErrors.common.cannotChangeOwnRole"));
    }

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);

    const { data: profile, error: profileErr } = await context.supabase
      .from("profiles")
      .select("department_id")
      .eq("id", data.user_id)
      .maybeSingle();
    if (profileErr) throw new Error(profileErr.message);
    if (!profile) throw new Error(i18n.t("serverErrors.common.employeeNotInBranch"));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await applyUserRoleChange(context.supabase, supabaseAdmin, {
      targetUserId: data.user_id,
      newRole: data.role,
      departmentId: profile.department_id ?? null,
      branchId: context.branchId,
      caps,
    });

    return { ok: true };
  });

export const updateEmployee = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => updateEmployeeSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canEdit) throw new Error(i18n.t("serverErrors.common.noEditEmployee"));
    if (data.role_changed && !caps.canManageUsers) {
      throw new Error(i18n.t("serverErrors.common.noChangeRole"));
    }
    if (!context.branchId) throw new Error(i18n.t("serverErrors.common.selectBranch"));

    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);

    if (data.user_id === context.userId && data.is_active_changed && !data.is_active) {
      throw new Error(i18n.t("serverErrors.common.cannotDisableSelf"));
    }

    let leaveStart = data.leave_start_date ?? null;
    let leaveEnd = data.leave_end_date ?? null;
    let leaveTypeCode = data.leave_type_code ?? null;
    if (data.on_leave) {
      if (!leaveStart || !leaveEnd) {
        throw new Error(i18n.t("serverErrors.common.leaveDatesRequired"));
      }
      if (leaveEnd < leaveStart) {
        throw new Error(i18n.t("serverErrors.common.leaveEndAfterStart"));
      }
      if (!leaveTypeCode) {
        throw new Error(i18n.t("serverErrors.common.leaveTypeRequired"));
      }
    } else {
      leaveStart = null;
      leaveEnd = null;
      leaveTypeCode = null;
    }

    const { data: dept, error: dErr } = await context.supabase
      .from("departments")
      .select("id, branch_id, manager_id")
      .eq("id", data.department_id)
      .maybeSingle();
    if (dErr) throw new Error(dErr.message);
    if (!dept || (dept as { branch_id: string }).branch_id !== context.branchId) {
      throw new Error(i18n.t("serverErrors.common.departmentNotInBranch"));
    }

    if (data.is_active_changed) {
      const { error: activeErr } = await context.supabase.rpc("set_employee_active", {
        _user_id: data.user_id,
        _active: data.is_active,
      });
      if (activeErr) throw new Error(activeErr.message);
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: existingProfile, error: existingProfileErr } = await supabaseAdmin
      .from("profiles")
      .select("id_number, first_name, last_name, full_name, department_id, on_leave, leave_start_date, leave_end_date, leave_type_code")
      .eq("id", data.user_id)
      .eq("branch_id", context.branchId)
      .maybeSingle();
    if (existingProfileErr) throw new Error(existingProfileErr.message);
    if (!existingProfile) throw new Error(i18n.t("serverErrors.common.employeeNotInBranch"));

    const { data: currentRoleRows, error: currentRolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    if (currentRolesErr) throw new Error(currentRolesErr.message);
    const currentRoles = new Set((currentRoleRows ?? []).map((row: any) => row.role as string));
    const resultingRole = data.role_changed && data.role
      ? data.role
      : currentRoles.has("department_manager")
        ? "department_manager"
        : null;
    const departmentChanged = existingProfile.department_id !== data.department_id;

    if (
      departmentChanged &&
      resultingRole === "department_manager" &&
      (dept as { manager_id?: string | null }).manager_id &&
      (dept as { manager_id?: string | null }).manager_id !== data.user_id
    ) {
      throw new Error(i18n.t("serverErrors.common.deptHasManager"));
    }

    const trimmedFirst = data.first_name.trim();
    const trimmedLast = data.last_name.trim();
    const nextIdNumber = data.id_number?.trim() || null;

    if (nextIdNumber) {
      if (!ID_REGEX.test(nextIdNumber)) throw new Error(i18n.t("serverErrors.common.invalidIdNumber"));
      await assertIdNumberAvailableInBranch(
        context.supabase,
        nextIdNumber,
        context.branchId,
        data.user_id,
      );
    }

    const { error: updErr } = await supabaseAdmin
      .from("profiles")
      .update({
        first_name: trimmedFirst,
        last_name: trimmedLast,
        full_name: `${trimmedFirst} ${trimmedLast}`.trim() || existingProfile.full_name,
        id_number: nextIdNumber,
        department_id: data.department_id,
        phone: data.phone || null,
        on_leave: data.on_leave,
        leave_start_date: leaveStart,
        leave_end_date: leaveEnd,
        leave_type_code: leaveTypeCode,
        job_title: data.job_title || null,
        avatar_url: data.avatar_url ?? null,
        ...(data.is_active_changed ? {} : { is_active: data.is_active }),
      })
      .eq("id", data.user_id)
      .eq("branch_id", context.branchId);
    if (updErr) throw new Error(updErr.message);

    const leaveChanged =
      existingProfile.on_leave !== data.on_leave ||
      (existingProfile.leave_start_date ?? null) !== leaveStart ||
      (existingProfile.leave_end_date ?? null) !== leaveEnd ||
      ((existingProfile as { leave_type_code?: string | null }).leave_type_code ?? null) !== leaveTypeCode;

    if (data.on_leave && leaveChanged) {
      await (context.supabase as any).rpc("write_leave_audit", {
        _action: "manual_leave_set",
        _request_id: null,
        _user_id: data.user_id,
        _payload: {
          on_leave: data.on_leave,
          leave_start_date: leaveStart,
          leave_end_date: leaveEnd,
          leave_type_code: leaveTypeCode,
          previous: {
            on_leave: existingProfile.on_leave,
            leave_start_date: existingProfile.leave_start_date,
            leave_end_date: existingProfile.leave_end_date,
            leave_type_code:
              (existingProfile as { leave_type_code?: string | null })
                .leave_type_code ?? null,
          },
        },
        _branch_id: context.branchId,
      });
      if (leaveStart && leaveEnd) {
        await (supabaseAdmin as any).rpc("apply_leave_to_schedule_shifts", {
          _user_id: data.user_id,
          _start: leaveStart,
          _end: leaveEnd,
          _branch_id: context.branchId,
          _leave_type_code: leaveTypeCode,
        });
      }
    } else if (!data.on_leave) {
      // Profile is not on leave — also cancel any open leave_requests so the
      // employee page cannot keep showing הארכה / ביטול (covers re-save after
      // an older clear that only flipped on_leave).
      const todayJerusalem = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Jerusalem",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());

      const { data: openLeaves } = await supabaseAdmin
        .from("leave_requests")
        .select("id, days_count, leave_type_id, start_date, end_date, branch_id, kind, status")
        .eq("user_id", data.user_id)
        .in("status", ["approved", "pending_dept", "pending_admin"]);

      const toCancel = (openLeaves ?? []).filter((row: any) => {
        if (row.status === "pending_dept" || row.status === "pending_admin") {
          return true;
        }
        return (
          row.kind === "leave" &&
          row.status === "approved" &&
          String(row.end_date).slice(0, 10) >= todayJerusalem
        );
      });

      const needsCancel = leaveChanged || toCancel.length > 0;
      if (needsCancel) {
        const { error: cancelErr } = await context.supabase.rpc(
          "admin_cancel_active_leave",
          {
            _user_id: data.user_id,
            _note: i18n.t("serverErrors.common.cancelledFromEdit"),
          },
        );

        if (cancelErr) {
          await (context.supabase as any).rpc("write_leave_audit", {
            _action: "manual_leave_cleared",
            _request_id: null,
            _user_id: data.user_id,
            _payload: {
              on_leave: false,
              leave_start_date: null,
              leave_end_date: null,
              leave_type_code: null,
              previous: {
                on_leave: existingProfile.on_leave,
                leave_start_date: existingProfile.leave_start_date,
                leave_end_date: existingProfile.leave_end_date,
                leave_type_code:
                  (existingProfile as { leave_type_code?: string | null })
                    .leave_type_code ?? null,
              },
              fallback_without_leave_approve: true,
              cancel_err: cancelErr.message,
            },
            _branch_id: context.branchId,
          });

          const prevStart =
            (existingProfile.leave_start_date as string | null)?.slice(0, 10) ??
            null;
          const prevEnd =
            (existingProfile.leave_end_date as string | null)?.slice(0, 10) ??
            null;
          if (prevStart && prevEnd) {
            await (supabaseAdmin as any).rpc("clear_leave_from_schedule_shifts", {
              _user_id: data.user_id,
              _start: prevStart,
              _end: prevEnd,
              _branch_id: context.branchId,
            });
          }

          const { data: actorProf } = await supabaseAdmin
            .from("profiles")
            .select("full_name, first_name, last_name")
            .eq("id", context.userId)
            .maybeSingle();
          const actorName =
            (actorProf as any)?.full_name?.trim() ||
            [(actorProf as any)?.first_name, (actorProf as any)?.last_name]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            i18n.t("common.manager");
          const whenLocal = new Intl.DateTimeFormat("he-IL", {
            timeZone: "Asia/Jerusalem",
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
            numberingSystem: "latn",
          }).format(new Date());

          for (const row of toCancel) {
            const r = row as any;
            const wasApprovedLeave =
              r.kind === "leave" && r.status === "approved";

            await supabaseAdmin
              .from("leave_requests")
              .update({
                status: "cancelled",
                admin_decided_by: context.userId,
                admin_decided_at: new Date().toISOString(),
                admin_decider_name: actorName,
                admin_note: i18n.t("serverErrors.common.cancelledFromEdit"),
                updated_at: new Date().toISOString(),
              })
              .eq("id", r.id);

            if (wasApprovedLeave && r.days_count != null && r.leave_type_id) {
              const { data: bal } = await supabaseAdmin
                .from("leave_balances")
                .select("used_days")
                .eq("user_id", data.user_id)
                .eq("leave_type_id", r.leave_type_id)
                .maybeSingle();
              if (bal) {
                await supabaseAdmin
                  .from("leave_balances")
                  .update({
                    used_days: Math.max(
                      0,
                      Number(bal.used_days ?? 0) - Number(r.days_count),
                    ),
                    updated_at: new Date().toISOString(),
                  })
                  .eq("user_id", data.user_id)
                  .eq("leave_type_id", r.leave_type_id);
              }
              if (r.start_date && r.end_date) {
                await (supabaseAdmin as any).rpc("clear_leave_from_schedule_shifts", {
                  _user_id: data.user_id,
                  _start: r.start_date,
                  _end: r.end_date,
                  _branch_id: r.branch_id ?? context.branchId,
                });
              }
            }
          }

          if (toCancel.length > 0) {
            try {
              const msg = i18n.t("serverErrors.common.leaveCancelledMsg", { actor: actorName, when: whenLocal });
              const { notifyUsersWithPush } = await import("@/lib/push-dispatch.server");
              await notifyUsersWithPush({
                userIds: [data.user_id],
                message: msg,
                scheduleId: null,
                branchId: context.branchId,
                tag: `leave-cancel-${data.user_id}-${Date.now()}`,
                eventKey: "leave_cancel",
              });
            } catch {
              /* non-fatal */
            }
          }
        }
      }

      // Always rebuild counters from approved/pending requests (fixes balances
      // left stale after an older cancel that only cleared the profile).
      await reconcileLeaveBalanceCounters(supabaseAdmin, data.user_id);
    }

    if (nextIdNumber) {
      await syncEmployeeAuthIdentity(supabaseAdmin, {
        userId: data.user_id,
        idNumber: nextIdNumber,
        firstName: trimmedFirst,
        lastName: trimmedLast,
      });
    }

    if (departmentChanged) {
      // A profile can belong to only one department. Remove stale department
      // ownership left behind by the previous department before applying any
      // explicit role change. This changes department links only—not roles or
      // permission rows.
      const { error: clearOldDeptErr } = await supabaseAdmin
        .from("departments")
        .update({ manager_id: null })
        .eq("manager_id", data.user_id)
        .eq("branch_id", context.branchId)
        .neq("id", data.department_id);
      if (clearOldDeptErr) throw new Error(clearOldDeptErr.message);

      // Move current/next-week shifts + open leave/break dept links with the employee.
      if (existingProfile.department_id) {
        const { error: transferErr } = await (supabaseAdmin as any).rpc(
          "transfer_employee_department_data",
          {
            _user_id: data.user_id,
            _from_dept: existingProfile.department_id,
            _to_dept: data.department_id,
            _branch_id: context.branchId,
          },
        );
        if (transferErr) throw new Error(transferErr.message);
      }
    }

    if (data.role_changed && data.role) {
      await applyUserRoleChange(context.supabase, supabaseAdmin, {
        targetUserId: data.user_id,
        newRole: data.role,
        departmentId: data.department_id,
        branchId: context.branchId,
        caps,
      });
    }

    // Repair/keep department ownership in sync whenever the resulting role is
    // department_manager (including saves that did not change the role).
    const { data: finalRoleRows, error: finalRolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    if (finalRolesErr) throw new Error(finalRolesErr.message);
    const isDeptManager = (finalRoleRows ?? []).some(
      (row: { role: string }) => row.role === "department_manager",
    );
    if (isDeptManager) {
      await ensureDepartmentManagerAssignment(supabaseAdmin, {
        userId: data.user_id,
        departmentId: data.department_id,
        branchId: context.branchId,
      });
    }

    return { ok: true };
  });

export const setEmployeeActive = createServerFn({ method: "POST" })
  .middleware([requireBranchContext])
  .inputValidator((data: unknown) => setActiveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const caps = await getEmployeeManagerCaps(context.supabase, context.userId);
    if (!caps.canEdit && !caps.canDelete) throw new Error(i18n.t("serverErrors.common.noUpdateEmployeeStatus"));
    await assertProfileVisibleInActiveBranch(context.supabase, data.user_id);
    await assertTargetIsNotProtectedManager(context.supabase, data.user_id, caps);
    if (data.user_id === context.userId && !data.is_active) {
      throw new Error(i18n.t("serverErrors.common.cannotDisableSelf"));
    }
    const { error } = await context.supabase.rpc("set_employee_active", {
      _user_id: data.user_id,
      _active: data.is_active,
      _note: data.note ?? undefined,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

