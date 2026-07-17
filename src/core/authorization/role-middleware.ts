/** Role Middleware — guard clause factory based on role assignment. */

import type { UUID } from "../types";
import type { IRoleAssignmentStore } from "./permission-resolver";

export class RoleRequiredError extends Error {
  constructor(roleId: UUID) {
    super(`Role required: ${roleId}`);
  }
}

export function requireRole(store: IRoleAssignmentStore, roleId: UUID) {
  return async (subjectId: UUID): Promise<void> => {
    const assignments = await store.getAssignments(subjectId);
    if (!assignments.some((a) => a.roleId === roleId)) {
      throw new RoleRequiredError(roleId);
    }
  };
}
