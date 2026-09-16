/**
 * Platform Feature Flag catalog.
 *
 * These keys are seeded into FeatureFlagManager at bootstrap so the
 * Platform Feature Flags page has a real list to toggle. Enabled state
 * for catalog keys is persisted on `platform_settings` and gates product
 * behavior. Main Board is a core feature and is intentionally not flagged.
 *
 * Retired keys are dropped on every boot so a removed flag cannot
 * reappear after deploy even if an older in-memory snapshot still holds it.
 */

export const DEFAULT_MIN_CLIENT_VERSION = "1.0.0";

export const DEFAULT_PLATFORM_FEATURE_FLAGS = [
  { key: "platform.maintenance_mode", enabled: false },
  { key: "platform.global_analytics", enabled: true },
  { key: "platform.beta_ai", enabled: true },
  { key: "platform.announcements", enabled: true },
  { key: "platform.self_serve_company_signup", enabled: false },
  { key: "platform.force_client_update", enabled: false },
  { key: "platform.realtime", enabled: true },
  { key: "platform.storage_quota_warnings", enabled: false },
] as const;

export const RETIRED_PLATFORM_FEATURE_FLAG_KEYS = ["platform.beta_billing"] as const;

export type DefaultPlatformFeatureFlagKey = (typeof DEFAULT_PLATFORM_FEATURE_FLAGS)[number]["key"];
export type RetiredPlatformFeatureFlagKey = (typeof RETIRED_PLATFORM_FEATURE_FLAG_KEYS)[number];

/** Postgres columns on `platform_settings` for the durable catalog keys. */
export const PLATFORM_FEATURE_FLAG_COLUMNS = {
  "platform.maintenance_mode": "ff_maintenance_mode",
  "platform.global_analytics": "ff_global_analytics",
  "platform.beta_ai": "ff_beta_ai",
  "platform.announcements": "ff_announcements",
  "platform.self_serve_company_signup": "ff_self_serve_company_signup",
  "platform.force_client_update": "ff_force_client_update",
  "platform.realtime": "ff_realtime",
  "platform.storage_quota_warnings": "ff_storage_quota_warnings",
} as const;

export type PlatformFeatureFlagState = {
  "platform.maintenance_mode": boolean;
  "platform.global_analytics": boolean;
  "platform.beta_ai": boolean;
  "platform.announcements": boolean;
  "platform.self_serve_company_signup": boolean;
  "platform.force_client_update": boolean;
  "platform.realtime": boolean;
  "platform.storage_quota_warnings": boolean;
};

/** Durable overlay including the min client version used by force-update. */
export type PlatformFeatureFlagSnapshot = PlatformFeatureFlagState & {
  minClientVersion: string;
};

export const PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY = ["platform-feature-flag-state"] as const;
export const PLATFORM_CLIENT_GATES_QUERY_KEY = ["platform-client-gates"] as const;

/** Public subset used by /auth, /company-signup, and pre-auth force-update checks. */
export type PlatformClientGates = {
  maintenanceMode: boolean;
  selfServeCompanySignup: boolean;
  forceClientUpdate: boolean;
  minClientVersion: string;
};

export function clientGatesFromSnapshot(snapshot: PlatformFeatureFlagSnapshot): PlatformClientGates {
  return {
    maintenanceMode: snapshot["platform.maintenance_mode"],
    selfServeCompanySignup: snapshot["platform.self_serve_company_signup"],
    forceClientUpdate: snapshot["platform.force_client_update"],
    minClientVersion: snapshot.minClientVersion,
  };
}

export function isRetiredPlatformFeatureFlagKey(key: string): boolean {
  return (RETIRED_PLATFORM_FEATURE_FLAG_KEYS as readonly string[]).includes(key);
}

export function isPersistedPlatformFeatureFlagKey(key: string): key is DefaultPlatformFeatureFlagKey {
  return DEFAULT_PLATFORM_FEATURE_FLAGS.some((flag) => flag.key === key);
}

/**
 * i18n path for a catalog flag label. Custom (non-catalog) flags return null
 * so the UI keeps the stored displayName/description.
 *
 * Nested as platformFeatureFlags.catalog.platform.<suffix>.{name,description}
 * because catalog keys look like `platform.maintenance_mode`.
 */
export function catalogFeatureFlagI18nKey(
  key: string,
  field: "name" | "description",
): string | null {
  if (!isPersistedPlatformFeatureFlagKey(key)) return null;
  return `platformFeatureFlags.catalog.${key}.${field}`;
}

export function resolveFeatureFlagDisplayName(
  flag: { key: string; displayName: string },
  translate: (key: string) => string,
): string {
  const path = catalogFeatureFlagI18nKey(flag.key, "name");
  return path ? translate(path) : flag.displayName;
}

export function resolveFeatureFlagDescription(
  flag: { key: string; description: string },
  translate: (key: string) => string,
): string {
  const path = catalogFeatureFlagI18nKey(flag.key, "description");
  return path ? translate(path) : flag.description;
}

/**
 * Writes stay platform-wide. Company/branch targeting for announcements
 * lives on `/platform/announcements`, not on Feature Flags (no pickers here).
 */
export function platformOnlyFlagScope(): { scope: "platform"; scopeTargetId: null } {
  return { scope: "platform", scopeTargetId: null };
}

export function defaultPlatformFeatureFlagState(): PlatformFeatureFlagState {
  return {
    "platform.maintenance_mode": false,
    "platform.global_analytics": true,
    "platform.beta_ai": true,
    "platform.announcements": true,
    "platform.self_serve_company_signup": false,
    "platform.force_client_update": false,
    "platform.realtime": true,
    "platform.storage_quota_warnings": false,
  };
}

export function defaultPlatformFeatureFlagSnapshot(): PlatformFeatureFlagSnapshot {
  return {
    ...defaultPlatformFeatureFlagState(),
    minClientVersion: DEFAULT_MIN_CLIENT_VERSION,
  };
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function asMinClientVersion(value: unknown, fallback = DEFAULT_MIN_CLIENT_VERSION): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return /^\d+\.\d+\.\d+$/.test(trimmed) ? trimmed : fallback;
}

/** Overlay a partial/DB row onto catalog defaults. Unknown keys are ignored. */
export function mergePlatformFeatureFlagState(
  partial?: Partial<Record<string, unknown>> | null,
): PlatformFeatureFlagState {
  const defaults = defaultPlatformFeatureFlagState();
  if (!partial) return defaults;
  return {
    "platform.maintenance_mode": asBoolean(
      partial["platform.maintenance_mode"],
      defaults["platform.maintenance_mode"],
    ),
    "platform.global_analytics": asBoolean(
      partial["platform.global_analytics"],
      defaults["platform.global_analytics"],
    ),
    "platform.beta_ai": asBoolean(partial["platform.beta_ai"], defaults["platform.beta_ai"]),
    "platform.announcements": asBoolean(
      partial["platform.announcements"],
      defaults["platform.announcements"],
    ),
    "platform.self_serve_company_signup": asBoolean(
      partial["platform.self_serve_company_signup"],
      defaults["platform.self_serve_company_signup"],
    ),
    "platform.force_client_update": asBoolean(
      partial["platform.force_client_update"],
      defaults["platform.force_client_update"],
    ),
    "platform.realtime": asBoolean(partial["platform.realtime"], defaults["platform.realtime"]),
    "platform.storage_quota_warnings": asBoolean(
      partial["platform.storage_quota_warnings"],
      defaults["platform.storage_quota_warnings"],
    ),
  };
}

export function mergePlatformFeatureFlagSnapshot(
  partial?: Partial<Record<string, unknown>> | null,
): PlatformFeatureFlagSnapshot {
  return {
    ...mergePlatformFeatureFlagState(partial),
    minClientVersion: asMinClientVersion(partial?.minClientVersion ?? partial?.min_client_version),
  };
}

function flagColumnValue(data: Record<string, unknown>, column: string, catalogKey: string): unknown {
  return data[column] ?? data[catalogKey];
}

/** Map a `platform_settings` / sync-table row (ff_* columns) onto the catalog snapshot. */
export function snapshotFromPlatformFlagColumns(
  data: Record<string, unknown> | null | undefined,
): PlatformFeatureFlagSnapshot {
  if (!data) return defaultPlatformFeatureFlagSnapshot();
  return mergePlatformFeatureFlagSnapshot({
    "platform.maintenance_mode": flagColumnValue(data, "ff_maintenance_mode", "platform.maintenance_mode"),
    "platform.global_analytics": flagColumnValue(data, "ff_global_analytics", "platform.global_analytics"),
    "platform.beta_ai": flagColumnValue(data, "ff_beta_ai", "platform.beta_ai"),
    "platform.announcements": flagColumnValue(data, "ff_announcements", "platform.announcements"),
    "platform.self_serve_company_signup": flagColumnValue(
      data,
      "ff_self_serve_company_signup",
      "platform.self_serve_company_signup",
    ),
    "platform.force_client_update": flagColumnValue(
      data,
      "ff_force_client_update",
      "platform.force_client_update",
    ),
    "platform.realtime": flagColumnValue(data, "ff_realtime", "platform.realtime"),
    "platform.storage_quota_warnings": flagColumnValue(
      data,
      "ff_storage_quota_warnings",
      "platform.storage_quota_warnings",
    ),
    minClientVersion: data.min_client_version ?? data.minClientVersion,
  });
}

/**
 * Overlay a realtime payload onto the current snapshot.
 * Missing columns keep the current value so a partial payload cannot reset flags.
 */
export function overlayPlatformFlagColumns(
  current: PlatformFeatureFlagSnapshot,
  data: Record<string, unknown> | null | undefined,
): PlatformFeatureFlagSnapshot {
  if (!data) return current;
  return {
    "platform.maintenance_mode": asBoolean(
      flagColumnValue(data, "ff_maintenance_mode", "platform.maintenance_mode"),
      current["platform.maintenance_mode"],
    ),
    "platform.global_analytics": asBoolean(
      flagColumnValue(data, "ff_global_analytics", "platform.global_analytics"),
      current["platform.global_analytics"],
    ),
    "platform.beta_ai": asBoolean(
      flagColumnValue(data, "ff_beta_ai", "platform.beta_ai"),
      current["platform.beta_ai"],
    ),
    "platform.announcements": asBoolean(
      flagColumnValue(data, "ff_announcements", "platform.announcements"),
      current["platform.announcements"],
    ),
    "platform.self_serve_company_signup": asBoolean(
      flagColumnValue(data, "ff_self_serve_company_signup", "platform.self_serve_company_signup"),
      current["platform.self_serve_company_signup"],
    ),
    "platform.force_client_update": asBoolean(
      flagColumnValue(data, "ff_force_client_update", "platform.force_client_update"),
      current["platform.force_client_update"],
    ),
    "platform.realtime": asBoolean(
      flagColumnValue(data, "ff_realtime", "platform.realtime"),
      current["platform.realtime"],
    ),
    "platform.storage_quota_warnings": asBoolean(
      flagColumnValue(data, "ff_storage_quota_warnings", "platform.storage_quota_warnings"),
      current["platform.storage_quota_warnings"],
    ),
    minClientVersion: asMinClientVersion(
      data.min_client_version ?? data.minClientVersion,
      current.minClientVersion,
    ),
  };
}

/** Catalog enabled map only — never includes minClientVersion. */
export function catalogEnabledStates(state: PlatformFeatureFlagState): PlatformFeatureFlagState {
  return mergePlatformFeatureFlagState(state);
}

/** Non-owners are blocked when maintenance is on. Platform Owners always pass. */
export function canAccessAppDuringMaintenance(input: {
  maintenanceMode: boolean;
  isPlatformOwner: boolean;
}): boolean {
  return !input.maintenanceMode || input.isPlatformOwner;
}

export function canSeeGlobalAnalytics(enabled: boolean): boolean {
  return enabled === true;
}

/**
 * `platform.beta_ai` is a kill-switch on top of existing grants.
 * Platform Owner access is never taken away by this flag.
 * When the flag is on, grantAllowed is unchanged (does not widen access).
 */
export function canUseAskAi(input: {
  betaAiEnabled: boolean;
  isPlatformOwner: boolean;
  grantAllowed: boolean;
}): boolean {
  if (!input.betaAiEnabled && !input.isPlatformOwner) return false;
  return input.grantAllowed === true;
}

export function canSeeAnnouncements(enabled: boolean): boolean {
  return enabled === true;
}

export function isSelfServeCompanySignupOpen(enabled: boolean): boolean {
  return enabled === true;
}

/**
 * Public login footer (non-bootstrap). WhatsApp stays independent of this flag.
 * While gates are still loading, hide both gated items so the "no account"
 * sentence does not flash when self-serve is already on.
 */
export function authLoginAccountFooter(input: {
  selfServeCompanySignup: boolean | undefined;
  gatesReady: boolean;
}): { showNoAccountMessage: boolean; showCompanySignupLink: boolean } {
  if (!input.gatesReady) {
    return { showNoAccountMessage: false, showCompanySignupLink: false };
  }
  const open = isSelfServeCompanySignupOpen(input.selfServeCompanySignup === true);
  return {
    showNoAccountMessage: !open,
    showCompanySignupLink: open,
  };
}

/** Public /auth and /company-signup: only when the gate is known to be on. */
export function shouldShowPublicMaintenance(input: {
  maintenanceMode: boolean | undefined;
  gatesReady: boolean;
}): boolean {
  return input.gatesReady && input.maintenanceMode === true;
}

export function canUseRealtimePresence(enabled: boolean): boolean {
  return enabled === true;
}

export function canSeeStorageQuotaWarnings(input: {
  enabled: boolean;
  isBranchManager: boolean;
  isAssistantManager: boolean;
  canManageCompanySettings: boolean;
}): boolean {
  if (!input.enabled) return false;
  if (input.isBranchManager) return true;
  return input.isAssistantManager && input.canManageCompanySettings;
}

/**
 * Force-update blocks non-owners when the flag is on and the running client
 * is older than minClientVersion. Platform Owners always pass.
 */
export function shouldForceClientUpdate(input: {
  forceClientUpdate: boolean;
  isPlatformOwner: boolean;
  currentIsOlderThanMin: boolean;
}): boolean {
  if (!input.forceClientUpdate || input.isPlatformOwner) return false;
  return input.currentIsOlderThanMin;
}
