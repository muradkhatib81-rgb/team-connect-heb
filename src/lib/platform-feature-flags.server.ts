/**
 * Durable Platform Feature Flag enabled-state.
 * Uses service role reads/writes. Does not touch roles or RLS policies.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  PLATFORM_FEATURE_FLAG_COLUMNS,
  asMinClientVersion,
  clientGatesFromSnapshot,
  defaultPlatformFeatureFlagSnapshot,
  snapshotFromPlatformFlagColumns,
  type DefaultPlatformFeatureFlagKey,
  type PlatformClientGates,
  type PlatformFeatureFlagSnapshot,
} from "@/core/config/platform-feature-flags";

export type { PlatformClientGates };

function isMissingRelationOrColumn(message: string): boolean {
  return /does not exist|column|relation/i.test(message);
}

const FLAG_SELECT =
  "ff_maintenance_mode, ff_global_analytics, ff_beta_ai, ff_announcements, ff_self_serve_company_signup, ff_force_client_update, ff_realtime, ff_storage_quota_warnings, min_client_version";

function rowToSnapshot(data: Record<string, unknown> | null | undefined): PlatformFeatureFlagSnapshot {
  return snapshotFromPlatformFlagColumns(data);
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

export async function loadPlatformClientGates(): Promise<PlatformClientGates> {
  return clientGatesFromSnapshot(await loadPlatformFeatureFlagState());
}
