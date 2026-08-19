/**
 * Central route-access policy for the existing persisted role model.
 *
 * This is a route-level guard only. Supabase RLS remains the authoritative
 * query/action boundary, so direct browser requests cannot use navigation or
 * URL access to obtain data outside the caller's scope.
 */

import { hasAnyScheduleViewPerm } from "@/lib/schedule-manager-caps";
import type { RouteGuardPermissions } from "@/lib/route-guard-data";

type RouteAccessInput = {
  pathname: string;
  roles: readonly string[];
  permissions: RouteGuardPermissions | null;
};

function hasRole(roles: readonly string[], ...allowed: string[]): boolean {
  return allowed.some((role) => roles.includes(role));
}

function isPlatformRole(roles: readonly string[]): boolean {
  return hasRole(roles, "system_admin", "main_admin");
}

function isGranularManager(roles: readonly string[]): boolean {
  return hasRole(roles, "branch_manager", "assistant_manager");
}

function grant(
  input: RouteAccessInput,
  key: keyof NonNullable<RouteGuardPermissions>,
): boolean {
  return isGranularManager(input.roles) && !!input.permissions?.[key];
}

function canManageEmployees(input: RouteAccessInput): boolean {
  return (
    isPlatformRole(input.roles) ||
    grant(input, "can_add_employee") ||
    grant(input, "can_edit_employee") ||
    grant(input, "can_delete_employee") ||
    grant(input, "can_reset_employee_password")
  );
}

function canViewEmployeesDirectory(input: RouteAccessInput): boolean {
  return (
    canManageEmployees(input) ||
    grant(input, "can_view_all_employees") ||
    grant(input, "can_view_employee_details")
  );
}

function hasScheduleDirectoryAccess(input: RouteAccessInput): boolean {
  return (
    isPlatformRole(input.roles) ||
    (isGranularManager(input.roles) && hasAnyScheduleViewPerm(input.permissions))
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
      isPlatformRole(roles) ||
      roles.includes("branch_manager") ||
      grant(input, "can_manage_employee_of_month")
    );
  }

  if (pathname === "/employees") {
    // Department heads may open a read-only, RLS-scoped view of their department.
    // Branch schedule operators need employee directory access to build schedules.
    // Assistants/BM with view-only grants may open the directory without write actions.
    return (
      canViewEmployeesDirectory(input) ||
      roles.includes("department_manager") ||
      hasScheduleDirectoryAccess(input)
    );
  }

  if (pathname === "/permissions") {
    return (
      isPlatformRole(roles) ||
      grant(input, "can_manage_permissions")
    );
  }

  if (pathname === "/company-settings") {
    return (
      isPlatformRole(roles) ||
      grant(input, "can_manage_company_settings") ||
      !!permissions?.can_manage_schedule
    );
  }

  if (pathname === "/departments") {
    return (
      isPlatformRole(roles) ||
      roles.includes("department_manager") ||
      grant(input, "can_manage_departments") ||
      hasScheduleDirectoryAccess(input)
    );
  }

  if (pathname === "/leaves-admin") {
    return (
      isPlatformRole(roles) ||
      roles.includes("department_manager") ||
      grant(input, "can_view_leave") ||
      grant(input, "can_approve_leave") ||
      grant(input, "can_reject_leave") ||
      grant(input, "can_edit_leave_balance")
    );
  }

  return true;
}
