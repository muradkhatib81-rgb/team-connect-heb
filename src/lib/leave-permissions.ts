import { useAuth } from "@/lib/use-auth";
import {
  useCurrentPermissions,
  type UserTaskPermissions,
} from "@/lib/use-current-permissions";
import type { AppRole } from "@/lib/constants";

/**
 * Leave UI/access: platform owners always; BM / assistant via grants;
 * department managers keep dept-stage queue by role.
 *
 * Balance / leave-system edits:
 * - platform owner: always
 * - branch_manager / assistant_manager: only with can_edit_leave_balance grant
 */
export function resolveLeaveAccess(
  roles: readonly AppRole[],
  permissions: UserTaskPermissions | null | undefined,
) {
  const isPlatformOwner =
    roles.includes("system_admin") || roles.includes("main_admin");
  const isBranchManager = roles.includes("branch_manager");
  const isAssistant = roles.includes("assistant_manager");
  const isDeptManager = roles.includes("department_manager");
  const isEmployeeOnly =
    !isPlatformOwner &&
    !isBranchManager &&
    !isAssistant &&
    !isDeptManager &&
    (roles.includes("employee") || roles.length === 0 || roles.every((r) => r === "employee"));

  const grant = (key: keyof UserTaskPermissions) =>
    (isBranchManager || isAssistant) && permissions?.[key] === true;

  // Personal leave request card / /leaves — not for branch manager or platform owner
  const showRequestCard =
    isDeptManager ||
    isAssistant ||
    isEmployeeOnly ||
    (!isPlatformOwner &&
      !isBranchManager &&
      !isDeptManager &&
      !isAssistant);

  const canApprove = isPlatformOwner || grant("can_approve_leave");
  const canReject = isPlatformOwner || grant("can_reject_leave");
  const canView =
    isPlatformOwner ||
    isDeptManager ||
    grant("can_view_leave") ||
    grant("can_approve_leave") ||
    grant("can_reject_leave") ||
    grant("can_edit_leave_balance");

  const canEditBalance =
    isPlatformOwner || grant("can_edit_leave_balance");

  // Pending queue: dept heads by role; BM/assistant when they have leave grants
  const hasAdminLeaveQueue =
    isPlatformOwner ||
    grant("can_approve_leave") ||
    grant("can_reject_leave") ||
    grant("can_view_leave") ||
    grant("can_edit_leave_balance");

  const showPendingQueueCard = isDeptManager || hasAdminLeaveQueue;

  const canOpenLeaveAdmin = showPendingQueueCard || canEditBalance || canView;
  const canOpenLeavesPage = showRequestCard;

  const pendingQueueMode: "dept" | "admin" | "both" | "none" = isDeptManager
    ? hasAdminLeaveQueue
      ? "both"
      : "dept"
    : hasAdminLeaveQueue
      ? "admin"
      : "none";

  return {
    isPlatformOwner,
    isBranchManager,
    isAssistant,
    isDeptManager,
    isEmployeeOnly,
    showRequestCard,
    showPendingQueueCard,
    pendingQueueMode,
    canView,
    canApprove,
    canReject,
    canEditBalance,
    canManageLeave: canView || canApprove || canReject || canEditBalance,
    canOpenLeaveAdmin,
    canOpenLeavesPage,
  };
}

export function useLeaveAccess() {
  const { data: profile } = useAuth();
  const roles = profile?.roles ?? [];
  const permsQ = useCurrentPermissions(profile?.id);
  const access = resolveLeaveAccess(roles, permsQ.data);

  return {
    ...access,
    roles,
    isLoading: permsQ.isLoading,
  };
}
