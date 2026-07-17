/** Permission Resolver — combines Role Engine + Permission Engine into a single check. */

import type { UUID } from "../types";
import { RoleEngine } from "./role-engine";
import { PermissionEngine } from "./permission-engine";
import type { RoleAssignment, Scope } from "./types";

export interface IRoleAssignmentStore {
  getAssignments(subjectId: UUID): Promise<RoleAssignment[]>;
}

export class InMemoryRoleAssignmentStore implements IRoleAssignmentStore {
  private readonly assignments = new Map<UUID, RoleAssignment[]>();

  add(assignment: RoleAssignment): void {
    const list = this.assignments.get(assignment.subjectId) ?? [];
    list.push(assignment);
    this.assignments.set(assignment.subjectId, list);
  }

  async getAssignments(subjectId: UUID): Promise<RoleAssignment[]> {
    return this.assignments.get(subjectId) ?? [];
  }
}

export class PermissionResolver {
  constructor(
    private readonly assignmentStore: IRoleAssignmentStore = new InMemoryRoleAssignmentStore(),
    private readonly roleEngine: RoleEngine = new RoleEngine(),
    private readonly permissionEngine: PermissionEngine = new PermissionEngine(),
  ) {}

  async hasPermission(subjectId: UUID, permissionKey: string, scope: Scope): Promise<boolean> {
    const assignments = await this.assignmentStore.getAssignments(subjectId);
    const applicable = assignments.filter((a) =>
      this.permissionEngine.scopeIncludes(a.scope, scope),
    );
    const grantedKeys = this.roleEngine.resolvePermissionKeys(applicable);
    return this.permissionEngine.evaluate(grantedKeys, permissionKey);
  }
}
