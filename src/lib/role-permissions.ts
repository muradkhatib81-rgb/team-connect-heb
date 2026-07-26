import type { AppRole } from "@/lib/constants";
import { PERMISSION_KEYS } from "@/lib/tasks.functions";

/** Baseline read-only permissions seeded for a new assistant / branch manager. */
export const DEFAULT_ASSISTANT_MANAGER_PERMISSIONS: Record<string, boolean> = {
  can_view_dashboard: true,
  can_view_all_employees: true,
  can_view_employee_details: true,
  can_view_schedule: true,
  can_view_tasks: true,
};

export const DEFAULT_BRANCH_MANAGER_PERMISSIONS = DEFAULT_ASSISTANT_MANAGER_PERMISSIONS;

export function emptyGranularPermissions(): Record<string, boolean> {
  const perms = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as Record<
    string,
    boolean
  >;
  perms.can_manage_tasks = false;
  return perms;
}

const PLATFORM_ROLES: AppRole[] = ["main_admin", "system_admin"];

/** Which role drives granular `user_task_permissions` for this user. */
export function effectivePermissionRole(roles: readonly AppRole[]): AppRole | null {
  const set = new Set(roles);
  if (PLATFORM_ROLES.some((role) => set.has(role))) return null;
  if (set.has("branch_manager")) return "branch_manager";
  if (set.has("department_manager")) return "department_manager";
  if (set.has("assistant_manager")) return "assistant_manager";
  return null;
}

export function permissionsForEffectiveRole(role: AppRole | null): Record<string, boolean> | null {
  if (role === "assistant_manager" || role === "branch_manager") {
    return {
      ...emptyGranularPermissions(),
      ...DEFAULT_ASSISTANT_MANAGER_PERMISSIONS,
    };
  }
  return null;
}

export function legacyCanManageTasks(perms: Record<string, boolean>): boolean {
  return !!perms.can_create_tasks && !!perms.can_edit_tasks && !!perms.can_delete_tasks;
}

export const SCHEDULE_PERMISSION_KEYS = [
  "can_view_schedule",
  "can_create_schedule",
  "can_edit_schedule",
  "can_approve_schedule",
  "can_publish_schedule",
  "can_manage_schedule",
] as const;

/** Action permissions for tasks — excludes read-only can_view_tasks. */
export const TASK_PERMISSION_KEYS = [
  "can_create_tasks",
  "can_edit_tasks",
  "can_delete_tasks",
  "can_approve_tasks",
  "can_manage_tasks",
] as const;

/** All custody / equipment management permissions. */
export const CUSTODY_PERMISSION_KEYS = [
  "can_create_custody",
  "can_edit_custody",
  "can_delete_custody",
  "can_return_custody",
  "can_receive_custody_alerts",
  "can_configure_custody",
  "can_view_custody_daily_log",
  "can_run_custody_monthly_report",
] as const;
