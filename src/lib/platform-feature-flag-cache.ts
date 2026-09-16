/**
 * Apply live platform flag / announcement events onto React Query.
 * Kept free of the Supabase client so unit tests can import it.
 */
import {
  PLATFORM_CLIENT_GATES_QUERY_KEY,
  PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
  clientGatesFromSnapshot,
  defaultPlatformFeatureFlagSnapshot,
  overlayPlatformFlagColumns,
  type PlatformFeatureFlagSnapshot,
} from "../core/config/platform-feature-flags";

export type FlagQueryCache = {
  getQueryData: (queryKey: readonly unknown[]) => unknown;
  setQueryData: (queryKey: readonly unknown[], data: unknown) => unknown;
  invalidateQueries: (opts: { queryKey: readonly unknown[] }) => unknown;
};

export const PLATFORM_FEATURE_FLAG_RELATED_QUERY_KEYS = [
  ["my-ai-access"],
  ["storage-quota-warning"],
  ["platform-feature-flags"],
  ["platform-announcements-visible"],
  ["platform-announcements-admin"],
] as const;

export function applyPlatformFeatureFlagSyncRow(
  qc: FlagQueryCache,
  row: Record<string, unknown> | null | undefined,
): void {
  if (!row) {
    void qc.invalidateQueries({ queryKey: PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY });
    void qc.invalidateQueries({ queryKey: PLATFORM_CLIENT_GATES_QUERY_KEY });
    return;
  }
  const current =
    (qc.getQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY) as PlatformFeatureFlagSnapshot | undefined) ??
    defaultPlatformFeatureFlagSnapshot();
  const next = overlayPlatformFlagColumns(current, row);
  qc.setQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY, next);
  qc.setQueryData(PLATFORM_CLIENT_GATES_QUERY_KEY, clientGatesFromSnapshot(next));
  for (const queryKey of PLATFORM_FEATURE_FLAG_RELATED_QUERY_KEYS) {
    void qc.invalidateQueries({ queryKey: [...queryKey] });
  }
}

export function invalidatePlatformAnnouncementQueries(qc: FlagQueryCache): void {
  void qc.invalidateQueries({ queryKey: ["platform-announcements-visible"] });
  void qc.invalidateQueries({ queryKey: ["platform-announcements-admin"] });
}
