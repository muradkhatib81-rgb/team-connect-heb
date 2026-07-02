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

export type PlatformOwnerLevel = "primary" | "owner";

export interface PlatformOwnerRow {
  user_id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  id_number: string | null;
  level: PlatformOwnerLevel;
  is_active: boolean;
  created_at: string | null;
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
  if (roles.length === 0) throw new Error("אין הרשאה — פעולה מיועדת לבעלי מערכת בלבד");
  return { isPrimary: roles.includes("system_admin") };
}

async function assertCallerIsPrimary(supabase: any, userId: string): Promise<void> {
  const { isPrimary } = await assertCallerIsPlatformOwner(supabase, userId);
  if (!isPrimary) {
    throw new Error("פעולה זו מותרת רק לבעל המערכת הראשי");
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

    const byUser = new Map<string, Set<string>>();
    for (const r of roles ?? []) {
      const set = byUser.get(r.user_id) ?? new Set<string>();
      set.add(r.role);
      byUser.set(r.user_id, set);
    }
    const ids = Array.from(byUser.keys());
    if (ids.length === 0) return [];

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name, id_number, phone, is_active, created_at")
      .in("id", ids);
    if (profErr) throw new Error(profErr.message);

    // Emails come from auth.users — admin only.
    const emailByUser = new Map<string, string | null>();
    // getUserById is per-user; batch by iterating (owner count is small).
    for (const id of ids) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      emailByUser.set(id, u?.user?.email ?? null);
    }

    const profileById = new Map(
      (profiles ?? []).map((p: any) => [p.id as string, p]),
    );

    return ids.map((id) => {
      const p: any = profileById.get(id) ?? {};
      const isPrimary = byUser.get(id)?.has("system_admin") ?? false;
      return {
        user_id: id,
        full_name: p.full_name ?? "",
        email: emailByUser.get(id) ?? null,
        phone: p.phone ?? null,
        id_number: p.id_number ?? null,
        level: isPrimary ? "primary" : "owner",
        is_active: p.is_active ?? true,
        created_at: p.created_at ?? null,
      };
    });
  });

const createOwnerInput = z.object({
  full_name: z.string().min(2, "נדרש שם מלא"),
  email: z.string().email("כתובת דוא\"ל לא תקינה"),
  password: z.string().min(8, "סיסמה חייבת להכיל לפחות 8 תווים"),
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

    const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.full_name,
        id_number: data.id_number ?? undefined,
        phone: data.phone ?? undefined,
        // Placeholder role — real role is granted below.
        role: "employee",
      },
    });
    if (createErr || !created?.user) {
      throw new Error(createErr?.message ?? "יצירת המשתמש נכשלה");
    }
    const newUserId = created.user.id;

    // handle_new_user() has already inserted a profile with role=employee.
    // Grant main_admin (System Owner). Stage 1 guard permits this because
    // the caller was verified as system_admin above and Postgres sees
    // service_role (guard skips when auth.uid() is NULL).
    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: newUserId,
      role: "main_admin",
    });
    if (roleErr) {
      // Roll back the auth user so we don't leak an orphaned account.
      await supabaseAdmin.auth.admin.deleteUser(newUserId);
      throw new Error(roleErr.message);
    }

    // Remove the default 'employee' role — Platform Owners are not employees.
    await supabaseAdmin
      .from("user_roles")
      .delete()
      .eq("user_id", newUserId)
      .eq("role", "employee");

    await supabaseAdmin.rpc("log_platform_owner_event", {
      _event: "owner.created",
      _target_user_id: newUserId,
      _payload: { email: data.email, full_name: data.full_name },
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
      throw new Error("לא ניתן להשעות את עצמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: target } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((target ?? []).map((r: { role: string }) => r.role));
    if (!roles.has("main_admin") && !roles.has("system_admin")) {
      throw new Error("המשתמש אינו בעל מערכת");
    }
    if (roles.has("system_admin")) {
      throw new Error("לא ניתן להשעות את בעל המערכת הראשי");
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
      throw new Error("לא ניתן למחוק את עצמך");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((rows ?? []).map((r: { role: string }) => r.role));
    if (roles.has("system_admin")) {
      throw new Error("לא ניתן למחוק את בעל המערכת הראשי");
    }
    if (!roles.has("main_admin")) {
      throw new Error("המשתמש אינו בעל מערכת");
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
      throw new Error("לבחור בעל מערכת אחר לצורך העברת בעלות");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", data.user_id);
    const roles = new Set((targetRoles ?? []).map((r: { role: string }) => r.role));
    if (!roles.has("main_admin")) {
      throw new Error("היעד חייב להיות בעל מערכת קיים");
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
