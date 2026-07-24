import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";

export const canRequestBreakQueryKey = (userId: string | null) =>
  ["can-request-break", userId] as const;

export const canManageBreaksQueryKey = (userId: string | null) =>
  ["my-break-manage-perm", userId] as const;

export async function fetchCanUserRequestBreak(userId: string): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("can_user_request_break", {
    _user_id: userId,
  });
  if (error) return false;
  return data === true;
}

export async function fetchCanManageBreaks(
  userId: string,
  roles: readonly string[],
): Promise<boolean> {
  // Match public.has_break_manage_perm: owners and branch managers by role,
  // assistants via the explicit can_manage_breaks grant.
  if (
    roles.includes("main_admin") ||
    roles.includes("system_admin") ||
    roles.includes("branch_manager")
  ) {
    return true;
  }
  const { data } = await supabase
    .from("user_task_permissions")
    .select("can_manage_breaks")
    .eq("user_id", userId)
    .maybeSingle();
  return !!(data as { can_manage_breaks?: boolean } | null)?.can_manage_breaks;
}

/** Job title + branch break policy — who may request/plan their own breaks. */
export function useCanUserRequestBreak() {
  const { data: profile } = useAuth();
  const userId = profile?.id ?? null;

  return useQuery({
    enabled: !!userId,
    queryKey: canRequestBreakQueryKey(userId),
    queryFn: () => fetchCanUserRequestBreak(userId!),
    staleTime: 30_000,
    retry: false,
  });
}

/** Platform-granted break management (approvals, admin screen, break types). */
export function useCanManageBreaks() {
  const { data: profile } = useAuth();
  const userId = profile?.id ?? null;
  const roles = profile?.roles ?? [];

  const q = useQuery({
    enabled: !!userId,
    queryKey: canManageBreaksQueryKey(userId),
    queryFn: () => fetchCanManageBreaks(userId!, roles),
    staleTime: 30_000,
    retry: false,
  });

  return {
    canManageBreaks: q.data === true,
    isLoading: q.isLoading,
  };
}
