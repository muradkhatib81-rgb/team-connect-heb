/**
 * Central route-access policy for the existing persisted role model.
 *
 * This is a route-level guard only. Supabase RLS remains the authoritative
 * query/action boundary, so direct browser requests cannot use navigation or
 * URL access to obtain data outside the caller's scope.
 */

import { hasAnyScheduleManagementPerm } from "@/lib/schedule-manager-caps";

type RouteAccessInput = {
  pathname: string;
  roles: readonly string[];
  permissions: {
    can_add_employee?: boolean;
    can_edit_employee?: boolean;
    can_delete_employee?: boolean;
    can_reset_employee_password?: boolean;
    can_manage_departments?: boolean;
    can_manage_employee_of_month?: boolean;
    can_create_schedule?: boolean;
    can_approve_schedule?: boolean;
    can_publish_schedule?: boolean;
    can_manage_schedule?: boolean;
  } | null;
};

function hasRole(roles: readonly string[], ...allowed: string[]): boolean {
  return allowed.some((role) => roles.includes(role));
}

function isPlatformOrBranchManager(roles: readonly string[]): boolean {
  return hasRole(roles, "system_admin", "main_admin", "branch_manager");
}

function canManageEmployees(input: RouteAccessInput): boolean {
  const { permissions, roles } = input;
  return (
    isPlatformOrBranchManager(roles) ||
    (roles.includes("assistant_manager") &&
      !!(
        permissions?.can_add_employee ||
        permissions?.can_edit_employee ||
        permissions?.can_delete_employee ||
        permissions?.can_reset_employee_password
      ))
  );
}

function hasScheduleDirectoryAccess(input: RouteAccessInput): boolean {
  const { permissions, roles } = input;
  return (
    isPlatformOrBranchManager(roles) ||
    (roles.includes("assistant_manager") && hasAnyScheduleManagementPerm(permissions))
  );
}

/**
 * Returns whether a sensitive branch route can be opened by the current user.
 * Routes not listed here are regular self-service/workflow routes and defer
 * their data visibility to RLS plus their existing server-action checks.
 */
export function canAccessRoute(input: RouteAccessInput): boolean {
  const { pathname, permissions, roles } = input;

  if (pathname === "/employee-of-month") {
    return (
      isPlatformOrBranchManager(roles) ||
      (roles.includes("assistant_manager") && !!permissions?.can_manage_employee_of_month)
    );
  }

  if (pathname === "/employees") {
    // Department heads may open a read-only, RLS-scoped view of their department.
    // Branch schedule operators need employee directory access to build schedules.
    return (
      canManageEmployees(input) ||
      roles.includes("department_manager") ||
      hasScheduleDirectoryAccess(input)
    );
  }

  if (pathname === "/permissions") {
    return isPlatformOrBranchManager(roles);
  }

  if (pathname === "/departments") {
    return (
      isPlatformOrBranchManager(roles) ||
      roles.includes("department_manager") ||
      (roles.includes("assistant_manager") && !!permissions?.can_manage_departments) ||
      hasScheduleDirectoryAccess(input)
    );
  }

  return true;
}
