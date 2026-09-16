import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadPlatformFeatureFlagState } from "@/lib/platform-feature-flags.server";

export type PlatformAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unauthorized");
}

async function assertAnnouncementsEnabled() {
  const flags = await loadPlatformFeatureFlagState();
  if (!flags["platform.announcements"]) {
    throw new Error("Announcements are turned off.");
  }
}

function mapRow(row: Record<string, unknown>): PlatformAnnouncementRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    company_id: (row.company_id as string | null) ?? null,
    branch_id: (row.branch_id as string | null) ?? null,
    is_active: row.is_active === true,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

/** Viewer list — RLS scopes company / branch / all. Empty when the kill-switch is off. */
export const listVisiblePlatformAnnouncements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAnnouncementRow[]> => {
    const flags = await loadPlatformFeatureFlagState();
    if (!flags["platform.announcements"]) return [];
    const { supabase } = context as { supabase: any };
    const { data, error } = await supabase
      .from("platform_announcements")
      .select("id, title, body, company_id, branch_id, is_active, created_at, updated_at")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
  });

/** Platform Owner list including inactive. */
export const listPlatformAnnouncementsAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformAnnouncementRow[]> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();
    const { data, error } = await supabase
      .from("platform_announcements")
      .select("id, title, body, company_id, branch_id, is_active, created_at, updated_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return ((data ?? []) as Record<string, unknown>[]).map(mapRow);
  });

const createInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  scope: z.enum(["all", "company", "branch"]),
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
});

export const createPlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlatformAnnouncementRow> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();

    let companyId: string | null = null;
    let branchId: string | null = null;
    if (data.scope === "company") {
      if (!data.companyId) throw new Error("Select a company.");
      companyId = data.companyId;
    } else if (data.scope === "branch") {
      if (!data.companyId || !data.branchId) throw new Error("Select a company and branch.");
      companyId = data.companyId;
      branchId = data.branchId;
    }

    const { data: row, error } = await supabase
      .from("platform_announcements")
      .insert({
        title: data.title,
        body: data.body,
        company_id: companyId,
        branch_id: branchId,
        is_active: true,
        created_by: userId,
      })
      .select("id, title, body, company_id, branch_id, is_active, created_at, updated_at")
      .single();
    if (error) throw new Error(error.message);
    return mapRow(row as Record<string, unknown>);
  });

const deleteInput = z.object({ id: z.string().uuid() });

export const deletePlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => deleteInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();
    const { error } = await supabase.from("platform_announcements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
