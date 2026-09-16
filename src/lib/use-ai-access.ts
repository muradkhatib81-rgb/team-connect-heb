import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAiAccess } from "@/lib/ai.functions";
import {
  applyBetaAiKillSwitch,
  NO_AI_ACCESS,
  PLATFORM_OWNER_AI_ACCESS,
  resolveAiAccessForUi,
} from "@/lib/ai-access-resolve";
import { isPlatformOwner } from "@/lib/constants";
import { useAuth } from "@/lib/use-auth";
import { usePlatformFeatureFlagState } from "@/lib/use-platform-feature-flags";

/**
 * Session AI entitlement. Intentionally NOT keyed by activeBranchId —
 * platform owners must see Ask AI on platform home with no branch selected.
 * Branch Mode still works: owners keep the same allow path; others resolve
 * grants from their profile/company/branch on the server.
 */
export function useAiAccess() {
  const { data: profile } = useAuth();
  const fn = useServerFn(getMyAiAccess);
  const isOwner = isPlatformOwner(profile?.roles ?? []);
  const flags = usePlatformFeatureFlagState();

  return useQuery({
    queryKey: ["my-ai-access", profile?.id ?? "anon", flags.betaAi],
    enabled: !!profile?.id && !flags.isLoading,
    queryFn: async () => {
      const apply = (access: ReturnType<typeof resolveAiAccessForUi>) =>
        applyBetaAiKillSwitch(access, {
          betaAiEnabled: flags.betaAi,
          isPlatformOwner: isOwner,
        });
      try {
        return apply(resolveAiAccessForUi(await fn(), isOwner));
      } catch {
        return apply(isOwner ? PLATFORM_OWNER_AI_ACCESS : NO_AI_ACCESS);
      }
    },
    placeholderData: isOwner ? PLATFORM_OWNER_AI_ACCESS : undefined,
    staleTime: 30_000,
  });
}
