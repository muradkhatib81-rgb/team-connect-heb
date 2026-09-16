/**
 * Durable Platform Feature Flag enabled-state.
 * Uses service role reads/writes. Does not touch roles or RLS policies.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PLATFORM_FEATURE_FLAG_COLUMNS,
  asMinClientVersion,
  defaultPlatformFeatureFlagSnapshot,
  mergePlatformFeatureFlagSnapshot,
  type DefaultPlatformFeatureFlagKey,
  type PlatformFeatureFlagSnapshot,
} from "@/core/config/platform-feature-flags";

function isMissingRelationOrColumn(message: string): boolean {
  return /does not exist|column|relation/i.test(message);
}

const FLAG_SELECT =
  "ff_maintenance_mode, ff_global_analytics, ff_beta_ai, ff_announcements, ff_self_serve_company_signup, ff_force_client_update, ff_realtime, ff_storage_quota_warnings, min_client_version";

function rowToSnapshot(data: Record<string, unknown> | null | undefined): PlatformFeatureFlagSnapshot {
  return mergePlatformFeatureFlagSnapshot({
    "platform.maintenance_mode": data?.ff_maintenance_mode,
    "platform.global_analytics": data?.ff_global_analytics,
    "platform.beta_ai": data?.ff_beta_ai,
    "platform.announcements": data?.ff_announcements,
    "platform.self_serve_company_signup": data?.ff_self_serve_company_signup,
    "platform.force_client_update": data?.ff_force_client_update,
    "platform.realtime": data?.ff_realtime,
    "platform.storage_quota_warnings": data?.ff_storage_quota_warnings,
    minClientVersion: data?.min_client_version,
  });
}

export async function loadPlatformFeatureFlagState(): Promise<PlatformFeatureFlagSnapshot> {
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .select(FLAG_SELECT)
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumn(error.message)) return defaultPlatformFeatureFlagSnapshot();
    throw new Error(error.message);
  }
  return rowToSnapshot(data);
}

export async function savePlatformFeatureFlagEnabled(
  key: DefaultPlatformFeatureFlagKey,
  enabled: boolean,
): Promise<PlatformFeatureFlagSnapshot> {
  const column = PLATFORM_FEATURE_FLAG_COLUMNS[key];
  const { error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .update({ [column]: enabled })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  return loadPlatformFeatureFlagState();
}

export async function saveMinClientVersion(version: string): Promise<PlatformFeatureFlagSnapshot> {
  const minClientVersion = asMinClientVersion(version);
  const { error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .update({ min_client_version: minClientVersion })
    .eq("id", 1);
  if (error) throw new Error(error.message);
  return loadPlatformFeatureFlagState();
}

export type PlatformClientGates = {
  selfServeCompanySignup: boolean;
  forceClientUpdate: boolean;
  minClientVersion: string;
};

export async function loadPlatformClientGates(): Promise<PlatformClientGates> {
  const snapshot = await loadPlatformFeatureFlagState();
  return {
    selfServeCompanySignup: snapshot["platform.self_serve_company_signup"],
    forceClientUpdate: snapshot["platform.force_client_update"],
    minClientVersion: snapshot.minClientVersion,
  };
}
