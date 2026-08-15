import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAiAccess } from "@/lib/ai.functions";

import type { ResolvedAiAccess } from "@/modules/ai";

const NO_ACCESS: ResolvedAiAccess = {
  allowed: false,
  grantId: null,
  providerCode: "gemini",
  assistantKind: "employee",
  remainingMinutes: null,
  quotaMinutes: null,
  grantSource: null,
};

export function useAiAccess() {
  const fn = useServerFn(getMyAiAccess);
  return useQuery({
    queryKey: ["my-ai-access"],
    queryFn: async () => {
      try {
        return await fn();
      } catch {
        return NO_ACCESS;
      }
    },
    staleTime: 30_000,
  });
}
