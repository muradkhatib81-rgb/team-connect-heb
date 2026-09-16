import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  asMinClientVersion,
  type PlatformClientGates,
  type PlatformFeatureFlagSnapshot,
} from "@/core/config/platform-feature-flags";
import {
  loadPlatformClientGates,
  loadPlatformFeatureFlagState,
  saveMinClientVersion,
  savePlatformFeatureFlagEnabled,
} from "@/lib/platform-feature-flags.server";

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unauthorized");
}

const catalogKey = z.enum([
  "platform.maintenance_mode",
  "platform.global_analytics",
  "platform.beta_ai",
  "platform.announcements",
  "platform.self_serve_company_signup",
  "platform.force_client_update",
  "platform.realtime",
  "platform.storage_quota_warnings",
]);

/** Any signed-in user may read catalog flags (needed for maintenance / force-update). */
export const getPlatformFeatureFlagState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<PlatformFeatureFlagSnapshot> => {
    return loadPlatformFeatureFlagState();
  });

/** Public subset for /company-signup (no auth). */
export const getPlatformClientGates = createServerFn({ method: "GET" }).handler(
  async (): Promise<PlatformClientGates> => {
    return loadPlatformClientGates();
  },
);

const setInput = z.object({
  key: catalogKey,
  enabled: z.boolean(),
});

/** Platform Owner only — persist enabled state for a catalog key. */
export const setPlatformFeatureFlagEnabled = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => setInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlatformFeatureFlagSnapshot> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    return savePlatformFeatureFlagEnabled(data.key, data.enabled);
  });

const minVersionInput = z.object({
  version: z.string().min(1).max(32),
});

/** Platform Owner only — persist min client version used by force-update. */
export const setMinClientVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => minVersionInput.parse(raw))
  .handler(async ({ data, context }): Promise<PlatformFeatureFlagSnapshot> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const version = asMinClientVersion(data.version, "");
    if (!version) throw new Error("Invalid version. Use major.minor.patch (e.g. 1.0.1).");
    return saveMinClientVersion(version);
  });
