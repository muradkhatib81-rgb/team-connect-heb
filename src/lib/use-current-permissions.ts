import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { AppRole } from "@/lib/constants";

export type UserTaskPermissions =
  Database["public"]["Tables"]["user_task_permissions"]["Row"];

export type UserTaskPermissionKey = {
  [K in keyof UserTaskPermissions]: UserTaskPermissions[K] extends boolean ? K : never;
}[keyof UserTaskPermissions];

export const currentPermissionsQueryKey = (userId: string | null | undefined) =>
  ["current-user-permissions", userId ?? null] as const;

export async function fetchCurrentPermissions(
  userId: string,
): Promise<UserTaskPermissions | null> {
  const { data, error } = await supabase
    .from("user_task_permissions")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function useCurrentPermissions(userId: string | null | undefined) {
  return useQuery({
    enabled: !!userId,
    queryKey: currentPermissionsQueryKey(userId),
    queryFn: () => fetchCurrentPermissions(userId!),
    staleTime: 30_000,
  });
}

/**
 * Platform owners always have authority. Branch managers and assistant
 * managers only get a capability when it is explicitly granted in
 * user_task_permissions (platform owner assigns grants).
 */
export function hasBranchActionPermission(
  roles: readonly AppRole[],
  permissions: UserTaskPermissions | null | undefined,
  key: UserTaskPermissionKey,
): boolean {
  if (roles.includes("system_admin") || roles.includes("main_admin")) {
    return true;
  }
  if (
    roles.includes("branch_manager") ||
    roles.includes("assistant_manager")
  ) {
    return permissions?.[key] === true;
  }
  return false;
}
