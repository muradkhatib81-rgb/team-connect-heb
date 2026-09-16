import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  PLATFORM_CLIENT_GATES_QUERY_KEY,
  PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
  defaultPlatformFeatureFlagSnapshot,
} from "@/core/config/platform-feature-flags";
import {
  getPlatformClientGates,
  getPlatformFeatureFlagState,
} from "@/lib/platform-feature-flags.functions";
import { useAuth } from "@/lib/use-auth";

export function usePlatformFeatureFlagState() {
  const { data: profile } = useAuth();
  const fn = useServerFn(getPlatformFeatureFlagState);
  const query = useQuery({
    queryKey: PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
    enabled: !!profile?.id,
    queryFn: () => fn(),
    staleTime: 30_000,
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
    staleTime: 30_000,
  });
}
