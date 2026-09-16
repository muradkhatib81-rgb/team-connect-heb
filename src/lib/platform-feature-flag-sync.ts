/**
 * Live platform feature-flag + announcement sync.
 *
 * Independent of `platform.realtime` (product presence/bridge kill-switch).
 * Does not subscribe through RealtimeBridge, which unmounts when that flag is off.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  applyPlatformFeatureFlagSyncRow,
  invalidatePlatformAnnouncementQueries,
  type FlagQueryCache,
} from "@/lib/platform-feature-flag-cache";

export const PLATFORM_FEATURE_FLAG_SYNC_CHANNEL = "platform-feature-flag-sync";
export const PLATFORM_FEATURE_FLAG_SYNC_TABLE = "platform_feature_flag_sync";
export const PLATFORM_ANNOUNCEMENTS_TABLE = "platform_announcements";

export function subscribePlatformFeatureFlagLiveUpdates(qc: FlagQueryCache): () => void {
  const channel = supabase
    .channel(PLATFORM_FEATURE_FLAG_SYNC_CHANNEL)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: PLATFORM_FEATURE_FLAG_SYNC_TABLE,
        filter: "id=eq.1",
      },
      (payload) => {
        const row = (payload.new ?? null) as Record<string, unknown> | null;
        applyPlatformFeatureFlagSyncRow(qc, row && Object.keys(row).length > 0 ? row : null);
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: PLATFORM_ANNOUNCEMENTS_TABLE },
      () => {
        invalidatePlatformAnnouncementQueries(qc);
      },
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
