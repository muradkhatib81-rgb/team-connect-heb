/** Who may view a schedule row at each workflow stage. */

export type ScheduleViewerCaps = {
  userId: string;
  isMainAdmin: boolean;
  isBranchMgr: boolean;
  isDeptMgr: boolean;
  canCreate: boolean;
  canApprove: boolean;
  canPublishDirect: boolean;
  departmentId: string | null;
};

export type ScheduleVisibilityRow = {
  status: string;
  published_at: string | null;
  submitted_at?: string | null;
  created_by?: string | null;
  department_id: string;
};

/** Branch-level schedule managers (not department heads acting on their own dept). */
function isBranchLevelScheduleViewer(caps: ScheduleViewerCaps): boolean {
  if (caps.isMainAdmin || caps.isBranchMgr) return true;
  if (caps.isDeptMgr) return false;
  return caps.canCreate || caps.canApprove || caps.canPublishDirect;
}

function isManagedDepartment(
  scheduleDeptId: string,
  caps: ScheduleViewerCaps,
  managedDeptIds?: string[],
): boolean {
  if (caps.departmentId === scheduleDeptId) return true;
  return !!managedDeptIds?.includes(scheduleDeptId);
}

/** Plain employee — no schedule management role or granular schedule permission. */
export function isPlainScheduleEmployee(caps: ScheduleViewerCaps): boolean {
  return (
    !caps.isMainAdmin &&
    !caps.isBranchMgr &&
    !caps.isDeptMgr &&
    !caps.canCreate &&
    !caps.canApprove &&
    !caps.canPublishDirect
  );
}

/**
 * Returns whether the viewer may see schedule content (not merely existence flags).
 * Does not alter role/permission definitions — only interprets existing caps for display.
 * - Employees: published approved schedules only.
 * - Branch managers / main admin / granular schedule perms: all schedules.
 * - Dept head: own-dept published; pending/approved-awaiting-publish; own drafts or
 *   post-submit rejected — but NOT manager-only drafts that were never submitted.
 */
export function canViewScheduleContent(
  schedule: ScheduleVisibilityRow | null | undefined,
  caps: ScheduleViewerCaps,
  managedDeptIds?: string[],
): boolean {
  if (!schedule) return false;

  if (isBranchLevelScheduleViewer(caps)) return true;

  if (!caps.isDeptMgr) {
    return schedule.status === "approved" && !!schedule.published_at;
  }

  if (!isManagedDepartment(schedule.department_id, caps, managedDeptIds)) return false;

  if (schedule.status === "approved" && schedule.published_at) return true;
  if (schedule.status === "pending_approval") return true;
  if (schedule.status === "approved" && !schedule.published_at) return true;

  if (schedule.status === "draft" || schedule.status === "rejected") {
    if (schedule.submitted_at) return true;
    if (schedule.created_by && schedule.created_by === caps.userId) return true;
    return false;
  }

  return false;
}
