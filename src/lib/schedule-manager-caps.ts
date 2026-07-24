/** Branch-level vs dept-head-only schedule operators (granular platform permissions). */

export type ScheduleTaskPermissions = {
  can_view_schedule?: boolean | null;
  can_create_schedule?: boolean | null;
  can_edit_schedule?: boolean | null;
  can_approve_schedule?: boolean | null;
  can_publish_schedule?: boolean | null;
  can_manage_schedule?: boolean | null;
};

export function hasAnyScheduleManagementPerm(
  perms?: ScheduleTaskPermissions | null,
): boolean {
  if (!perms) return false;
  return !!(
    perms.can_create_schedule ||
    perms.can_edit_schedule ||
    perms.can_approve_schedule ||
    perms.can_publish_schedule ||
    perms.can_manage_schedule
  );
}

export function hasAnyScheduleViewPerm(
  perms?: ScheduleTaskPermissions | null,
): boolean {
  return !!(perms?.can_view_schedule || hasAnyScheduleManagementPerm(perms));
}

/** Main admin, branch manager, or assistant with any schedule workflow permission. */
export function isBranchLevelScheduleManager(
  roles: readonly string[],
  perms?: ScheduleTaskPermissions | null,
): boolean {
  if (roles.includes("main_admin") || roles.includes("system_admin")) return true;
  if (roles.includes("branch_manager")) return true;
  if (roles.includes("assistant_manager") && hasAnyScheduleManagementPerm(perms)) {
    return true;
  }
  return false;
}

/** Department head scoped to own dept — not a branch-level schedule operator. */
export function isDepartmentHeadOnlyScope(
  roles: readonly string[],
  perms?: ScheduleTaskPermissions | null,
): boolean {
  return roles.includes("department_manager") && !isBranchLevelScheduleManager(roles, perms);
}

export type ResolvedScheduleManagerCaps = {
  isMainAdmin: boolean;
  isBranchManager: boolean;
  isAssistantManager: boolean;
  isDeptMgr: boolean;
  isBranchMgr: boolean;
  isDeptHeadOnly: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canView: boolean;
  canApprove: boolean;
  canPublishDirect: boolean;
};

export function resolveScheduleManagerCaps(
  roles: readonly string[],
  perms?: ScheduleTaskPermissions | null,
): ResolvedScheduleManagerCaps {
  const p = perms ?? {};
  const isMainAdmin = roles.includes("main_admin") || roles.includes("system_admin");
  const isBranchManager = roles.includes("branch_manager");
  const isAssistantManager = roles.includes("assistant_manager");
  const isDeptMgr = roles.includes("department_manager");
  const branchLevel = isBranchLevelScheduleManager(roles, p);
  const privileged = isMainAdmin || isBranchManager;
  const assistantCanView =
    isAssistantManager &&
    !!(
      p.can_view_schedule ||
      p.can_create_schedule ||
      p.can_edit_schedule ||
      p.can_approve_schedule ||
      p.can_publish_schedule ||
      p.can_manage_schedule
    );

  return {
    isMainAdmin,
    isBranchManager,
    isAssistantManager,
    isDeptMgr,
    isBranchMgr: branchLevel,
    isDeptHeadOnly: isDepartmentHeadOnlyScope(roles, p),
    canView: privileged || assistantCanView || isDeptMgr,
    canCreate:
      privileged ||
      (isAssistantManager && !!p.can_create_schedule) ||
      (isDeptMgr && !branchLevel),
    canEdit:
      privileged ||
      (isAssistantManager && (!!p.can_edit_schedule || !!p.can_manage_schedule)) ||
      (isDeptMgr && !branchLevel),
    canApprove:
      privileged ||
      (isAssistantManager && !!p.can_approve_schedule),
    canPublishDirect:
      privileged ||
      (isAssistantManager && !!p.can_publish_schedule),
  };
}

export type DashboardScheduleScope =
  | { kind: "branch" }
  | { kind: "department"; departmentId: string; useCoworkersView: boolean }
  | { kind: "none" };

/** Maps viewer caps to dashboard daily-overview scope (branch / own dept / none). */
export function resolveDashboardScheduleScope(args: {
  caps: ResolvedScheduleManagerCaps;
  departmentId?: string | null;
  managedDepartmentId?: string | null;
}): DashboardScheduleScope {
  const { caps, departmentId, managedDepartmentId } = args;

  if (caps.isBranchMgr || (caps.isAssistantManager && caps.canView)) {
    return { kind: "branch" };
  }

  if (caps.isDeptHeadOnly) {
    const deptId = managedDepartmentId ?? departmentId ?? null;
    if (!deptId) return { kind: "none" };
    return { kind: "department", departmentId: deptId, useCoworkersView: false };
  }

  if (departmentId) {
    return { kind: "department", departmentId, useCoworkersView: true };
  }

  return { kind: "none" };
}

/** Roles whose branch-level schedule access depends on loaded task permissions. */
export function scheduleScopeNeedsLoadedPermissions(roles: readonly string[]): boolean {
  return roles.includes("assistant_manager");
}
