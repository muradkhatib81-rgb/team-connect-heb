import { supabase } from "@/integrations/supabase/client";
import type { AppRole } from "./constants";

const ROUTE_GUARD_STALE_MS = 30_000;

export type RouteGuardPermissions = {
  can_add_employee: boolean | null;
  can_edit_employee: boolean | null;
  can_delete_employee: boolean | null;
  can_reset_employee_password: boolean | null;
  can_manage_departments: boolean | null;
  can_manage_employee_of_month: boolean | null;
};

export async function fetchRouteGuardRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return (data ?? []).map((row) => row.role as AppRole);
}

export async function fetchRouteGuardPermissions(
  userId: string,
): Promise<RouteGuardPermissions | null> {
  const { data, error } = await supabase
    .from("user_task_permissions")
    .select(
      "can_add_employee, can_edit_employee, can_delete_employee, can_reset_employee_password, can_manage_departments, can_manage_employee_of_month",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchRouteGuardProfileActive(userId: string): Promise<boolean> {
  const { unscopedFrom } = await import("@/integrations/supabase/branch-scope");
  const profilesFrom = unscopedFrom("profiles") as ReturnType<typeof supabase.from>;
  const { data, error } = await profilesFrom.select("is_active").eq("id", userId).maybeSingle();
  if (error) throw error;
  return data?.is_active ?? false;
}

export const routeGuardStaleTime = ROUTE_GUARD_STALE_MS;
