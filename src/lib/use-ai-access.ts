import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMyAiAccess } from "@/lib/ai.functions";

export function useAiAccess() {
  const fn = useServerFn(getMyAiAccess);
  return useQuery({
    queryKey: ["my-ai-access"],
    queryFn: () => fn(),
    staleTime: 30_000,
  });
}
