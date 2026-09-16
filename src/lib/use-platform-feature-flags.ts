import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PLATFORM_CLIENT_GATES_QUERY_KEY,
  PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
  defaultPlatformFeatureFlagSnapshot,
} from "@/core/config/platform-feature-flags";
import { subscribePlatformFeatureFlagLiveUpdates } from "@/lib/platform-feature-flag-sync";
import type { FlagQueryCache } from "@/lib/platform-feature-flag-cache";
import {
  getPlatformClientGates,
  getPlatformFeatureFlagState,
} from "@/lib/platform-feature-flags.functions";
import { useAuth } from "@/lib/use-auth";

/** Short cache once live postgres_changes keep the snapshot fresh. */
const FLAG_STATE_STALE_MS = 5_000;

let liveSubscribers = 0;
let liveUnsubscribe: (() => void) | null = null;

/**
 * Always-on flag/announcement realtime. Not gated by `platform.realtime`.
 * Ref-counted so many hook consumers share one Supabase channel.
 */
function usePlatformFeatureFlagLiveSync(enabled: boolean) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    liveSubscribers += 1;
    if (liveSubscribers === 1) {
      liveUnsubscribe = subscribePlatformFeatureFlagLiveUpdates(qc as FlagQueryCache);
    }
    return () => {
      liveSubscribers -= 1;
      if (liveSubscribers <= 0) {
        liveSubscribers = 0;
        liveUnsubscribe?.();
        liveUnsubscribe = null;
      }
    };
  }, [enabled, qc]);
}

export function usePlatformFeatureFlagState() {
  const { data: profile } = useAuth();
  const fn = useServerFn(getPlatformFeatureFlagState);
  usePlatformFeatureFlagLiveSync(!!profile?.id);
  const query = useQuery({
    queryKey: PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
    enabled: !!profile?.id,
    queryFn: () => fn(),
    staleTime: FLAG_STATE_STALE_MS,
  });
  const state = query.data ?? defaultPlatformFeatureFlagSnapshot();
  return {
    ...query,
    state,
    maintenanceMode: state["platform.maintenance_mode"],
    globalAnalytics: state["platform.global_analytics"],
    betaAi: state["platform.beta_ai"],
    announcements: state["platform.announcements"],
    selfServeCompanySignup: state["platform.self_serve_company_signup"],
    forceClientUpdate: state["platform.force_client_update"],
    realtime: state["platform.realtime"],
    storageQuotaWarnings: state["platform.storage_quota_warnings"],
    minClientVersion: state.minClientVersion,
  };
}

export function usePlatformClientGates() {
  const fn = useServerFn(getPlatformClientGates);
  return useQuery({
    queryKey: PLATFORM_CLIENT_GATES_QUERY_KEY,
    queryFn: () => fn(),
    staleTime: FLAG_STATE_STALE_MS,
  });
}
