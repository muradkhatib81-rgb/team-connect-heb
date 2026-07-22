/** Shared task execution / visibility rules (client + server). */

export type TaskAssigneeShape = {
  assignee_id: string | null;
  department_id: string | null;
};

export function taskHasSpecificAssignees(
  task: TaskAssigneeShape,
  multiAssigneeIds: string[],
): boolean {
  return !!task.assignee_id || multiAssigneeIds.length > 0;
}

/** Only the task creator may change title, assignee, due date, etc. */
export function canEditTaskContent(
  task: { created_by: string | null },
  userId: string,
): boolean {
  return !!task.created_by && task.created_by === userId;
}

/** Who may start / submit a task for completion. */
export function canExecuteTask(
  task: TaskAssigneeShape,
  userId: string,
  profileDeptId: string | null,
  multiAssigneeIds: string[],
): boolean {
  if (taskHasSpecificAssignees(task, multiAssigneeIds)) {
    return task.assignee_id === userId || multiAssigneeIds.includes(userId);
  }
  return !!profileDeptId && task.department_id === profileDeptId;
}

/** Which tasks appear in an employee's task list. */
export function canViewTask(
  task: TaskAssigneeShape & { created_by?: string | null },
  userId: string,
  profileDeptId: string | null,
  multiAssigneeIds: string[],
): boolean {
  if (task.created_by === userId) return true;
  return canExecuteTask(task, userId, profileDeptId, multiAssigneeIds);
}

export const EXECUTABLE_TASK_STATUSES = new Set(["new", "in_progress"]);
