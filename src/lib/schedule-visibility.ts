/** Who may view a schedule row at each workflow stage. */

export type ScheduleViewerCaps = {
  userId: string;
  isMainAdmin: boolean;
  isBranchMgr: boolean;
  isDeptMgr: boolean;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canApprove: boolean;
  canPublishDirect: boolean;
  departmentId: string | null;
};

export type ScheduleVisibilityRow = {
  status: string;
  published_at: string | null;
  submitted_at?: string | null;
  submitted_by?: string | null;
  created_by?: string | null;
  department_id: string;
};

/** הנהלה — branch-managed; no department-head workflow or manager_id injection. */
export function isManagementDepartment(
  dept: { code?: string | null } | null | undefined,
): boolean {
  return dept?.code === "management";
}

/** Saved workflow row that is not yet published to employees / dept heads. */
export function isSavedScheduleAwaitingPublish(
  schedule: Pick<ScheduleVisibilityRow, "status" | "published_at"> | null | undefined,
): boolean {
  if (!schedule) return false;
  if (schedule.status === "approved" && schedule.published_at) return false;
  return (
    schedule.status === "draft" ||
    schedule.status === "pending_approval" ||
    (schedule.status === "approved" && !schedule.published_at)
  );
}

/** Dept-head draft/rejected row they may still edit (draft before submit, or rejected for fixes). */
export function isDeptHeadEditableDraft(
  schedule: Pick<
    ScheduleVisibilityRow,
    "status" | "submitted_at" | "created_by" | "submitted_by"
  >,
  userId: string,
): boolean {
  const owns =
    schedule.created_by === userId || schedule.submitted_by === userId;
  if (!owns) return false;
  if (schedule.status === "rejected") return true;
  return schedule.status === "draft" && !schedule.submitted_at;
}

/** Dept-head submission waiting on management approval — hidden from editor. */
export function isDeptHeadSubmittedAwaitingApproval(
  schedule: Pick<
    ScheduleVisibilityRow,
    "status" | "submitted_at" | "created_by" | "submitted_by"
  >,
  userId: string,
): boolean {
  return (
    schedule.status === "pending_approval" &&
    !!schedule.submitted_at &&
    (schedule.created_by === userId || schedule.submitted_by === userId)
  );
}

/** Manager/branch saved schedule (not dept-head draft or pending submission). */
export function isManagerSavedScheduleForDeptHead(
  schedule: ScheduleVisibilityRow | null | undefined,
  deptHeadUserId: string,
): boolean {
  if (!schedule || !isSavedScheduleAwaitingPublish(schedule)) return false;
  if (isDeptHeadEditableDraft(schedule, deptHeadUserId)) return false;
  if (isDeptHeadSubmittedAwaitingApproval(schedule, deptHeadUserId)) return false;
  return true;
}

/** Branch-level schedule managers (not department heads acting on their own dept). */
export function isBranchLevelScheduleViewer(caps: ScheduleViewerCaps): boolean {
  if (caps.isMainAdmin || caps.isBranchMgr) return true;
  if (caps.isDeptMgr) return false;
  return (
    caps.canView ||
    caps.canCreate ||
    caps.canEdit ||
    caps.canApprove ||
    caps.canPublishDirect
  );
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
    !caps.canView &&
    !caps.canCreate &&
    !caps.canEdit &&
    !caps.canApprove &&
    !caps.canPublishDirect
  );
}

/**
 * Returns whether the viewer may see schedule content (not merely existence flags).
 * Does not alter role/permission definitions — only interprets existing caps for display.
 * - Employees: published approved schedules only.
 * - Branch managers / main admin / granular schedule perms: all schedules.
 * - Dept head: own-dept published schedules; own draft/rejected before submit only.
 *   Manager-saved rows and post-submit pending rows stay hidden until publish.
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

  if (isDeptHeadEditableDraft(schedule, caps.userId)) return true;

  return false;
}
