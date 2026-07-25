import { useAuth } from "@/lib/use-auth";
import {
  useCurrentPermissions,
  type UserTaskPermissions,
} from "@/lib/use-current-permissions";
import type { AppRole } from "@/lib/constants";

/**
 * Leave UI/access driven by role first; granular grants only where noted.
 *
 * Cards / routes:
 * - employee → request leave only
 * - department_manager → request + dept pending queue
 * - assistant_manager → request + pending queue (admin stage via grants)
 * - branch_manager → pending queue only (no personal request card)
 *
 * Balance / leave-system edits:
 * - platform owner (system/main admin): always
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

  // Personal leave request card / /leaves — not for branch manager or platform owner
  const showRequestCard = isDeptManager || isAssistant || isEmployeeOnly ||
    (!isPlatformOwner &&
      !isBranchManager &&
      !isDeptManager &&
      !isAssistant);

  // Pending approvals card — by role
  const showPendingQueueCard = isDeptManager || isAssistant || isBranchManager || isPlatformOwner;

  const assistantGrant = (key: keyof UserTaskPermissions) =>
    isAssistant && permissions?.[key] === true;

  const branchLeaveGrant = (key: keyof UserTaskPermissions) =>
    isBranchManager && permissions?.[key] === true;

  // Approve/reject/view at admin stage
  const canApprove =
    isPlatformOwner || isBranchManager || assistantGrant("can_approve_leave");
  const canReject =
    isPlatformOwner || isBranchManager || assistantGrant("can_reject_leave");
  const canView =
    isPlatformOwner ||
    isBranchManager ||
    isDeptManager ||
    assistantGrant("can_view_leave") ||
    assistantGrant("can_approve_leave") ||
    assistantGrant("can_reject_leave") ||
    assistantGrant("can_edit_leave_balance");

  // Balance / accrual / leave-system edits — NOT automatic for branch managers
  const canEditBalance =
    isPlatformOwner ||
    assistantGrant("can_edit_leave_balance") ||
    branchLeaveGrant("can_edit_leave_balance");

  const canOpenLeaveAdmin = showPendingQueueCard || canEditBalance || canView;
  const canOpenLeavesPage = showRequestCard;

  /** Which pending statuses this role handles on the queue card */
  const pendingQueueMode: "dept" | "admin" | "both" | "none" = isDeptManager
    ? isAssistant || isBranchManager || isPlatformOwner
      ? "both"
      : "dept"
    : isAssistant || isBranchManager || isPlatformOwner
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
