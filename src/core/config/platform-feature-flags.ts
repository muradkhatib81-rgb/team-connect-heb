/**
 * Platform Feature Flag catalog.
 *
 * These keys are seeded into FeatureFlagManager at bootstrap so the
 * Platform Feature Flags page has a real list to toggle. They do not
 * currently gate product behavior.
 *
 * Retired keys are dropped on every boot so a removed flag cannot
 * reappear after deploy even if an older in-memory snapshot still holds it.
 */

export const DEFAULT_PLATFORM_FEATURE_FLAGS = [
  { key: "platform.maintenance_mode", enabled: false },
  { key: "platform.global_analytics", enabled: true },
  { key: "platform.beta_ai", enabled: true },
] as const;

export const RETIRED_PLATFORM_FEATURE_FLAG_KEYS = ["platform.beta_billing"] as const;

export type DefaultPlatformFeatureFlagKey = (typeof DEFAULT_PLATFORM_FEATURE_FLAGS)[number]["key"];
export type RetiredPlatformFeatureFlagKey = (typeof RETIRED_PLATFORM_FEATURE_FLAG_KEYS)[number];

export function isRetiredPlatformFeatureFlagKey(key: string): boolean {
  return (RETIRED_PLATFORM_FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}
