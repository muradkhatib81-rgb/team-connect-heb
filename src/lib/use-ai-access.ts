import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAiAccess } from "@/lib/ai.functions";
import {
  NO_AI_ACCESS,
  PLATFORM_OWNER_AI_ACCESS,
  resolveAiAccessForUi,
} from "@/lib/ai-access-resolve";
import { isPlatformOwner } from "@/lib/constants";
import { useAuth } from "@/lib/use-auth";

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

  return useQuery({
    queryKey: ["my-ai-access", profile?.id ?? "anon"],
    enabled: !!profile?.id,
    queryFn: async () => {
      try {
        return resolveAiAccessForUi(await fn(), isOwner);
      } catch {
        return isOwner ? PLATFORM_OWNER_AI_ACCESS : NO_AI_ACCESS;
      }
    },
    placeholderData: isOwner ? PLATFORM_OWNER_AI_ACCESS : undefined,
    staleTime: 30_000,
  });
}
