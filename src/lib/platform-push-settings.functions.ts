import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PLATFORM_PUSH_EVENTS,
  type PlatformPushEventKey,
  isPlatformPushEventKey,
} from "@/lib/platform-push-events";

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .in("role", ["system_admin", "main_admin"]);
  if (error) throw new Error(error.message);
  if (!(data ?? []).length) {
    throw new Error("אין הרשאה — בעל מערכת בלבד");
  }
}

const eventCache = new Map<string, { enabled: boolean; at: number }>();
let scopesCache: { at: number; hasAny: boolean; branchIds: Set<string>; companyIds: Set<string> } | null =
  null;
const CACHE_MS = 15_000;

export function invalidatePlatformPushSettingsCache() {
  eventCache.clear();
  scopesCache = null;
}

async function loadScopes() {
  if (scopesCache && Date.now() - scopesCache.at < CACHE_MS) return scopesCache;
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_push_scopes")
    .select("company_id, branch_id, enabled")
    .eq("enabled", true);
  if (error) {
    console.warn("[push-settings] scopes read failed:", error.message);
    scopesCache = { at: Date.now(), hasAny: false, branchIds: new Set(), companyIds: new Set() };
    return scopesCache;
  }
  const branchIds = new Set<string>();
  const companyIds = new Set<string>();
  for (const row of data ?? []) {
    if (row.branch_id) branchIds.add(row.branch_id as string);
    if (row.company_id) companyIds.add(row.company_id as string);
  }
  scopesCache = {
    at: Date.now(),
    hasAny: (data ?? []).length > 0,
    branchIds,
    companyIds,
  };
  return scopesCache;
}

export async function isPlatformPushEventEnabled(eventKey: string): Promise<boolean> {
  if (!isPlatformPushEventKey(eventKey)) return true;
  const hit = eventCache.get(eventKey);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.enabled;

  const { data, error } = await (supabaseAdmin as any)
    .from("platform_push_settings")
    .select("push_enabled")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (error) {
    console.warn("[push-settings] read failed:", error.message);
    return true;
  }
  const enabled = data?.push_enabled ?? true;
  eventCache.set(eventKey, { enabled, at: Date.now() });
  return enabled;
}

export async function isPlatformPushScopeAllowed(branchId: string | null | undefined): Promise<boolean> {
  const scopes = await loadScopes();
  if (!scopes.hasAny) return true;
  if (!branchId) return false;
  if (scopes.branchIds.has(branchId)) return true;
  if (!scopes.companyIds.size) return false;

  const { data } = await (supabaseAdmin as any)
    .from("company_branch_assignments")
    .select("company_id")
    .eq("source_branch_id", branchId)
    .is("deleted_at", null)
    .maybeSingle();
  const companyId = data?.company_id as string | undefined;
  return !!companyId && scopes.companyIds.has(companyId);
}

/** Event + company/branch scope. Missing event row → enabled. No scopes → all branches. */
export async function isPlatformPushEnabled(
  eventKey: string,
  branchId?: string | null,
): Promise<boolean> {
  if (!(await isPlatformPushEventEnabled(eventKey))) return false;
  // undefined branchId → event-only check (caller filters recipients by scope).
  if (branchId === undefined) return true;
  return isPlatformPushScopeAllowed(branchId);
}

/** Filter recipients to those whose branch is in an allowed push scope. */
export async function filterUserIdsForPushScope(userIds: string[]): Promise<string[]> {
  const scopes = await loadScopes();
  if (!scopes.hasAny) return userIds;
  if (!userIds.length) return [];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("id, branch_id")
    .in("id", userIds);

  const out: string[] = [];
  for (const p of profiles ?? []) {
    if (await isPlatformPushScopeAllowed((p as { branch_id?: string | null }).branch_id)) {
      out.push((p as { id: string }).id);
    }
  }
  return out;
}

export const listPlatformPushSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context.supabase, context.userId);
    const { data, error } = await (supabaseAdmin as any)
      .from("platform_push_settings")
      .select("event_key, push_enabled, updated_at");
    if (error) throw new Error(error.message);

    const map = new Map(
      (data ?? []).map((r: { event_key: string; push_enabled: boolean; updated_at: string }) => [
        r.event_key,
        r,
      ]),
    );

    return PLATFORM_PUSH_EVENTS.map((ev) => {
      const row = map.get(ev.key);
      return {
        key: ev.key as PlatformPushEventKey,
        label: ev.label,
        group: ev.group,
        pushEnabled: row?.push_enabled ?? true,
        updatedAt: row?.updated_at ?? null,
      };
    });
  });

export const setPlatformPushSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        eventKey: z.string().refine(isPlatformPushEventKey, "invalid event"),
        pushEnabled: z.boolean(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context.supabase, context.userId);
    const { error } = await (supabaseAdmin as any).from("platform_push_settings").upsert(
      {
        event_key: data.eventKey,
        push_enabled: data.pushEnabled,
        updated_at: new Date().toISOString(),
        updated_by: context.userId,
      },
      { onConflict: "event_key" },
    );
    if (error) throw new Error(error.message);
    invalidatePlatformPushSettingsCache();
    return { ok: true as const };
  });

export const listPlatformPushScopes = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertPlatformOwner(context.supabase, context.userId);

    const [{ data: scopes, error: sErr }, { data: companies }, { data: branches }, { data: assigns }] =
      await Promise.all([
        (supabaseAdmin as any)
          .from("platform_push_scopes")
          .select("id, company_id, branch_id, enabled, updated_at")
          .order("created_at", { ascending: true }),
        (supabaseAdmin as any)
          .from("companies")
          .select("id, name, status")
          .is("deleted_at", null)
          .order("name"),
        supabaseAdmin.from("branches").select("id, name, code, is_active").order("name"),
        (supabaseAdmin as any)
          .from("company_branch_assignments")
          .select("company_id, source_branch_id, name")
          .is("deleted_at", null),
      ]);
    if (sErr) throw new Error(sErr.message);

    const companyName = new Map(
      (companies ?? []).map((c: { id: string; name: string }) => [c.id, c.name]),
    );
    const branchName = new Map(
      (branches ?? []).map((b: { id: string; name: string; code: string }) => [
        b.id,
        `${b.name} (${b.code})`,
      ]),
    );

    return {
      scopes: (scopes ?? []).map(
        (s: {
          id: string;
          company_id: string | null;
          branch_id: string | null;
          enabled: boolean;
          updated_at: string;
        }) => ({
          id: s.id,
          companyId: s.company_id,
          branchId: s.branch_id,
          enabled: s.enabled,
          updatedAt: s.updated_at,
          label: s.company_id
            ? `חברה: ${companyName.get(s.company_id) ?? s.company_id}`
            : `סניף: ${branchName.get(s.branch_id!) ?? s.branch_id}`,
        }),
      ),
      companies: (companies ?? []).map((c: { id: string; name: string; status: string }) => ({
        id: c.id,
        name: c.name,
        status: c.status,
      })),
      branches: (branches ?? []).map((b: { id: string; name: string; code: string; is_active: boolean }) => ({
        id: b.id,
        name: b.name,
        code: b.code,
        isActive: b.is_active,
      })),
      assignments: (assigns ?? []).map(
        (a: { company_id: string; source_branch_id: string; name: string }) => ({
          companyId: a.company_id,
          branchId: a.source_branch_id,
          name: a.name,
        }),
      ),
    };
  });

export const addPlatformPushScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        companyId: z.string().uuid().optional(),
        branchId: z.string().uuid().optional(),
      })
      .refine((v) => (!!v.companyId) !== (!!v.branchId), {
        message: "יש לבחור חברה או סניף",
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context.supabase, context.userId);
    const { error: insErr } = await (supabaseAdmin as any).from("platform_push_scopes").insert({
      company_id: data.companyId ?? null,
      branch_id: data.branchId ?? null,
      enabled: true,
      updated_at: new Date().toISOString(),
      updated_by: context.userId,
    });
    if (insErr) {
      if (insErr.code === "23505") throw new Error("ההיקף כבר קיים");
      throw new Error(insErr.message);
    }
    invalidatePlatformPushSettingsCache();
    return { ok: true as const };
  });

export const removePlatformPushScope = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    await assertPlatformOwner(context.supabase, context.userId);
    const { error } = await (supabaseAdmin as any)
      .from("platform_push_scopes")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    invalidatePlatformPushSettingsCache();
    return { ok: true as const };
  });
