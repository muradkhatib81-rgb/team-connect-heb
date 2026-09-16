import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadPlatformFeatureFlagState } from "@/lib/platform-feature-flags.server";
import {
  isPlatformAnnouncementImagePath,
  PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET,
  resolveAnnouncementScope,
} from "@/lib/platform-announcements";

export type PlatformAnnouncementRow = {
  id: string;
  title: string;
  body: string;
  company_id: string | null;
  branch_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  image_path: string | null;
  image_url: string | null;
};

const ROW_COLUMNS =
  "id, title, body, company_id, branch_id, is_active, created_at, updated_at, image_path";

const imagePathInput = z
  .string()
  .trim()
  .refine((value) => isPlatformAnnouncementImagePath(value), "Invalid image path")
  .nullable()
  .optional();

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
    image_path: (row.image_path as string | null) ?? null,
    image_url: null,
  };
}

async function attachSignedUrls(
  supabase: any,
  rows: PlatformAnnouncementRow[],
): Promise<PlatformAnnouncementRow[]> {
  const paths = [
    ...new Set(rows.map((row) => row.image_path).filter((path): path is string => !!path)),
  ];
  if (paths.length === 0) return rows;

  const { data } = await supabase.storage
    .from(PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET)
    .createSignedUrls(paths, 60 * 60);
  const urlByPath = new Map<string, string>();
  for (const item of data ?? []) {
    const path = typeof item?.path === "string" ? item.path : null;
    const url = item?.signedUrl || item?.signedURL || null;
    if (path && url && !item?.error) urlByPath.set(path, url);
  }
  return rows.map((row) => ({
    ...row,
    image_url: row.image_path ? (urlByPath.get(row.image_path) ?? null) : null,
  }));
}

async function removeStoredImage(supabase: any, path: string | null | undefined) {
  if (!path) return;
  await supabase.storage
    .from(PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET)
    .remove([path])
    .catch(() => {});
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
      .select(ROW_COLUMNS)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) {
      if (/does not exist|relation/i.test(error.message)) return [];
      throw new Error(error.message);
    }
    return attachSignedUrls(supabase, ((data ?? []) as Record<string, unknown>[]).map(mapRow));
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
      .select(ROW_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return attachSignedUrls(supabase, ((data ?? []) as Record<string, unknown>[]).map(mapRow));
  });

const createInput = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4000),
  scope: z.enum(["all", "company", "branch"]),
  companyId: z.string().uuid().nullable().optional(),
  branchId: z.string().uuid().nullable().optional(),
  imagePath: imagePathInput,
});

export const createPlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => createInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlatformAnnouncementRow> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();

    const { companyId, branchId } = resolveAnnouncementScope(data);

    const { data: row, error } = await supabase
      .from("platform_announcements")
      .insert({
        title: data.title,
        body: data.body,
        company_id: companyId,
        branch_id: branchId,
        is_active: true,
        created_by: userId,
        image_path: data.imagePath ?? null,
      })
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    const mapped = mapRow(row as Record<string, unknown>);
    return (await attachSignedUrls(supabase, [mapped]))[0];
  });

const updateInput = createInput.extend({
  id: z.string().uuid(),
});

export const updatePlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => updateInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlatformAnnouncementRow> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();

    const { companyId, branchId } = resolveAnnouncementScope(data);

    const { data: existing, error: existingError } = await supabase
      .from("platform_announcements")
      .select("id, image_path")
      .eq("id", data.id)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);
    if (!existing) throw new Error("Announcement not found.");

    const previousPath = (existing.image_path as string | null) ?? null;
    const nextPath = data.imagePath === undefined ? previousPath : data.imagePath;

    const { data: row, error } = await supabase
      .from("platform_announcements")
      .update({
        title: data.title,
        body: data.body,
        company_id: companyId,
        branch_id: branchId,
        image_path: nextPath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.id)
      .select(ROW_COLUMNS)
      .single();
    if (error) throw new Error(error.message);

    if (previousPath && previousPath !== nextPath) {
      await removeStoredImage(supabase, previousPath);
    }

    const mapped = mapRow(row as Record<string, unknown>);
    return (await attachSignedUrls(supabase, [mapped]))[0];
  });

const deleteInput = z.object({ id: z.string().uuid() });

export const deletePlatformAnnouncement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => deleteInput.parse(raw))
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    await assertAnnouncementsEnabled();

    const { data: existing } = await supabase
      .from("platform_announcements")
      .select("image_path")
      .eq("id", data.id)
      .maybeSingle();

    const { error } = await supabase.from("platform_announcements").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await removeStoredImage(supabase, existing?.image_path);
    return { ok: true };
  });
