/**
 * Platform Owner Management — dedicated business-layer server functions.
 *
 * Architectural rule: employee RPCs never touch platform owners; platform
 * owner management never uses employee RPCs. This file is the ONLY entry
 * point the app uses to list, create, suspend, restore, delete, promote,
 * demote, or transfer Platform Owners.
 *
 * Internal role mapping (private implementation detail — never surfaced):
 *   Primary System Owner (בעל המערכת הראשי) ↔ system_admin
 *   System Owner         (בעל המערכת)       ↔ main_admin
 *
 * Every mutation is audited via public.log_platform_owner_event.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import i18n from "@/i18n";
import { formatEmployeeName } from "./employee-name";

export type PlatformOwnerLevel = "primary" | "owner";

export interface PlatformOwnerRow {
  user_id: string;
  first_name: string;
  last_name: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number: string | null;
  avatar_url: string | null;
  level: PlatformOwnerLevel;
  is_active: boolean;
  created_at: string | null;
  last_sign_in_at: string | null;
}

type OwnerRolesByUser = Map<string, Set<string>>;

function buildOwnerRolesByUser(
  rows: { user_id: string; role: string }[],
): OwnerRolesByUser {
  const byUser: OwnerRolesByUser = new Map();
  for (const r of rows) {
    const set = byUser.get(r.user_id) ?? new Set<string>();
    set.add(r.role);
    byUser.set(r.user_id, set);
  }
  return byUser;
}

/**
 * Primary Platform Owner resolution:
 * - `system_admin` marks the Primary owner when present.
 * - When bootstrap created only `main_admin` (no `system_admin` row yet),
 *   the earliest main_admin is treated as Primary — same rule as migration
 *   20260630195103 backfill.
 */
function resolvePrimaryOwnerUserId(byUser: OwnerRolesByUser): string | null {
  for (const [id, roles] of byUser) {
    if (roles.has("system_admin")) return id;
  }
  const mainAdminIds = [...byUser.entries()]
    .filter(([, roles]) => roles.has("main_admin"))
    .map(([id]) => id)
    .sort();
  return mainAdminIds[0] ?? null;
}

async function loadOwnerRolesByUser(supabaseAdmin: any): Promise<OwnerRolesByUser> {
  const { data: roles, error } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["system_admin", "main_admin"]);
  if (error) throw new Error(error.message);
  return buildOwnerRolesByUser(roles ?? []);
}

async function assertCallerIsPlatformOwner(
  supabase: any,
  userId: string,
): Promise<{ isPrimary: boolean }> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["system_admin", "main_admin"]);
  if (error) throw new Error(error.message);
  const roles = (data ?? []).map((r: { role: string }) => r.role);
  if (roles.length === 0) throw new Error(i18n.t("serverErrors.common.platformOwnersOnly"));
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const byUser = await loadOwnerRolesByUser(supabaseAdmin);
  return { isPrimary: resolvePrimaryOwnerUserId(byUser) === userId };
}

async function assertCallerIsPrimary(supabase: any, userId: string): Promise<void> {
  const { isPrimary } = await assertCallerIsPlatformOwner(supabase, userId);
  if (!isPrimary) {
    throw new Error(i18n.t("serverErrors.common.primaryOwnerOnly"));
  }
}

/** List all Platform Owners (visible to any Platform Owner). */
export const listPlatformOwners = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformOwnerRow[]> => {
    await assertCallerIsPlatformOwner(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .in("role", ["system_admin", "main_admin"]);
    if (rolesErr) throw new Error(rolesErr.message);

    const byUser = buildOwnerRolesByUser(roles ?? []);
    const primaryUserId = resolvePrimaryOwnerUserId(byUser);
    const ids = Array.from(byUser.keys());
    if (ids.length === 0) return [];

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, first_name, last_name, full_name, id_number, phone, avatar_url, is_active, created_at")
      .in("id", ids);
    if (profErr) throw new Error(profErr.message);

    // Emails + last_sign_in_at come from auth.users — admin only.
    const emailByUser = new Map<string, string | null>();
    const lastSignInByUser = new Map<string, string | null>();
    // getUserById is per-user; batch by iterating (owner count is small).
    for (const id of ids) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      emailByUser.set(id, u?.user?.email ?? null);
      lastSignInByUser.set(id, u?.user?.last_sign_in_at ?? null);
    }

    const profileById = new Map(
      (profiles ?? []).map((p: any) => [p.id as string, p]),
    );

    return ids.map((id) => {
      const p: any = profileById.get(id) ?? {};
      const isPrimary = id === primaryUserId;
      return {
        user_id: id,
        first_name: p.first_name ?? "",
        last_name: p.last_name ?? "",
        full_name: formatEmployeeName(p),
        email: emailByUser.get(id) ?? null,
        phone: p.phone ?? null,
        id_number: p.id_number ?? null,
        avatar_url: p.avatar_url ?? null,
        level: isPrimary ? "primary" : "owner",
        is_active: p.is_active ?? true,
        created_at: p.created_at ?? null,
        last_sign_in_at: lastSignInByUser.get(id) ?? null,
      };
    });
  });


const createOwnerInput = z.object({
  first_name: z.string().trim().min(1, i18n.t("serverErrors.common.firstNameMin")).max(50),
  last_name: z.string().trim().min(1, i18n.t("serverErrors.common.lastNameMin")).max(50),
  email: z.string().email(i18n.t("serverErrors.common.invalidEmail")),
  password: z.string().min(8, i18n.t("serverErrors.common.passwordMin8")),
  id_number: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
});

/** Create a new System Owner. Only the Primary System Owner may call this. */
export const createPlatformOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createOwnerInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ user_id: string }> => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Create the auth user tagged as a Platform Owner from the start.
    // handle_new_user() reads role='main_admin' from user_metadata and takes
    // the Platform Owner branch — no department_id / branch_id on the profile
    // — and inserts the main_admin row into user_roles itself. This avoids
    // the classic bug where tagging the new user as 'employee' during creation
    // caused handle_new_user() to auto-assign a fallback department, which
    // then made enforce_owner_grant_membership reject the subsequent
    // main_admin grant with "המשתמש משויך למחלקה או לסניף".
    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        first_name: data.first_name,
        last_name: data.last_name,
        id_number: data.id_number ?? undefined,
        phone: data.phone ?? undefined,
        role: "main_admin",
      },
    });
    if (createErr || !created?.user) {
      // Log the complete error server-side and surface the real cause.
      const errAny = createErr as any;
      console.error("createPlatformOwner: auth.admin.createUser failed", {
        message: errAny?.message,
        status: errAny?.status,
        code: errAny?.code,
        name: errAny?.name,
        stack: errAny?.stack,
      });
      const detail = [errAny?.message, errAny?.code ? `(code: ${errAny.code})` : null, errAny?.status ? `(status: ${errAny.status})` : null]
        .filter(Boolean)
        .join(" ");
      throw new Error(detail || i18n.t("serverErrors.common.userCreateFailed"));
    }
    const newUserId = created.user.id;

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.created",
      _target_user_id: newUserId,
      _payload: { email: data.email, first_name: data.first_name, last_name: data.last_name },
    });


    return { user_id: newUserId };
  });

const userIdInput = z.object({ user_id: z.string().uuid() });

/** Suspend a System Owner. Primary only. Cannot target another Primary. */
export const suspendPlatformOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => userIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error(i18n.t("serverErrors.common.cannotSuspendSelf"));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((target ?? []).map((r: { role: string }) => r.role));
    if (!roles.has("main_admin") && !roles.has("system_admin")) {
      throw new Error(i18n.t("serverErrors.common.userNotPlatformOwner"));
    }
    if (roles.has("system_admin")) {
      throw new Error(i18n.t("serverErrors.common.cannotSuspendPrimary"));
    }

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: false, deactivated_at: new Date().toISOString() })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.suspended",
      _target_user_id: data.user_id,
      _payload: {},
    });
    return { ok: true };
  });

/** Restore a suspended System Owner. Primary only. */
export const restorePlatformOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => userIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ is_active: true, deactivated_at: null })
      .eq("id", data.user_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.restored",
      _target_user_id: data.user_id,
      _payload: {},
    });
    return { ok: true };
  });

/**
 * Permanently delete a System Owner (auth account + profile). Primary only.
 * The Primary System Owner is protected by existing DB triggers — this
 * function additionally refuses to target them for a clearer error.
 */
export const deletePlatformOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => userIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error(i18n.t("serverErrors.common.cannotDeleteSelf"));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((rows ?? []).map((r: { role: string }) => r.role));
    if (roles.has("system_admin")) {
      throw new Error(i18n.t("serverErrors.common.cannotDeletePrimary"));
    }
    if (!roles.has("main_admin")) {
      throw new Error(i18n.t("serverErrors.common.userNotPlatformOwner"));
    }

    // Delete roles first (guards allow it because service_role has no auth.uid()).
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    await supabaseAdmin.from("profiles").delete().eq("id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.deleted",
      _target_user_id: data.user_id,
      _payload: {},
    });
    return { ok: true };
  });

/**
 * Transfer Primary System Ownership from the caller to another existing
 * System Owner. Atomic swap: the target receives system_admin, the previous
 * primary keeps main_admin (they remain a System Owner). Primary only.
 */
export const transferPrimaryOwnership = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => userIdInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    if (data.user_id === context.userId) {
      throw new Error(i18n.t("serverErrors.common.chooseOtherOwner"));
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((targetRoles ?? []).map((r: { role: string }) => r.role));
    if (!roles.has("main_admin")) {
      throw new Error(i18n.t("serverErrors.common.targetMustBeOwner"));
    }

    // The enforce_single_system_admin trigger requires only one system_admin
    // at a time — remove first, then grant.
    const { error: delErr } = await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", context.userId)
      .eq("role", "system_admin");
    if (delErr) throw new Error(delErr.message);

    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: data.user_id, role: "system_admin" });
    if (insErr) {
      // Rollback: restore caller as system_admin.
      await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: context.userId, role: "system_admin" });
      throw new Error(insErr.message);
    }

    // Ensure the former primary keeps main_admin (they were both).
    await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: context.userId, role: "main_admin" },
        { onConflict: "user_id,role", ignoreDuplicates: true },
      );

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.primary_transferred",
      _target_user_id: data.user_id,
      _payload: { from: context.userId },
    });
    return { ok: true };
  });

/** Read the audit log — Platform Owners only. */
export const listPlatformOwnerAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertCallerIsPlatformOwner(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("platform_owner_audit_log")
      .select("id, actor_id, target_user_id, event, payload, created_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const updateProfileInput = z.object({
  user_id: z.string().uuid(),
  first_name: z.string().trim().min(1, i18n.t("serverErrors.common.firstNameMin")).max(50),
  last_name: z.string().trim().min(1, i18n.t("serverErrors.common.lastNameMin")).max(50),
  phone: z.string().trim().nullable().optional(),
  id_number: z.string().trim().nullable().optional(),
});

/**
 * Update a Platform Owner's platform-profile fields. Primary only.
 * Only touches platform-identity columns (full_name, phone, id_number).
 * Never modifies employee-domain columns (branch, department, job_title).
 * Email changes are intentionally not supported yet (future capability).
 */
export const updatePlatformOwnerProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => updateProfileInput.parse(raw))
  .handler(async ({ data, context }) => {
    await assertCallerIsPrimary(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((rows ?? []).map((r: { role: string }) => r.role));
    if (!roles.has("main_admin") && !roles.has("system_admin")) {
      throw new Error(i18n.t("serverErrors.common.userNotPlatformOwner"));
    }

    const patch: { first_name: string; last_name: string; phone?: string | null; id_number?: string | null } = {
      first_name: data.first_name,
      last_name: data.last_name,
    };
    if (data.phone !== undefined) patch.phone = data.phone ?? null;
    if (data.id_number !== undefined) patch.id_number = data.id_number ?? null;

    const { error } = await supabaseAdmin
      .from("profiles")
      .update(patch)
      .eq("id", data.user_id);

    if (error) throw new Error(error.message);

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.profile_updated",
      _target_user_id: data.user_id,
      _payload: { fields: Object.keys(patch) },
    });
    return { ok: true };
  });

/**
 * Non-throwing Platform Owner status check for the authenticated caller.
 * Used by the client (nav + /platform layout gate) to derive visibility
 * from the same source-of-truth used by every mutation guard, rather than
 * from role labels. Returns { isOwner:false, isPrimary:false } for
 * non-owners instead of throwing.
 */
export const getPlatformOwnerStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isOwner: boolean; isPrimary: boolean }> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    const { data, error } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["system_admin", "main_admin"]);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r: { role: string }) => r.role);
    if (roles.length === 0) return { isOwner: false, isPrimary: false };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const byUser = await loadOwnerRolesByUser(supabaseAdmin);
    return {
      isOwner: true,
      isPrimary: resolvePrimaryOwnerUserId(byUser) === userId,
    };
  });
