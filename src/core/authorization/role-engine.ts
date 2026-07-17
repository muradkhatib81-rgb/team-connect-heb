/** Role Engine — resolves a role's permission keys. */

import type { UUID } from "../types";
import { RoleRegistry } from "./role-registry";
import type { RoleAssignment } from "./types";

export class RoleEngine {
  constructor(private readonly roles: RoleRegistry = new RoleRegistry()) {}

  resolvePermissionKeys(assignments: RoleAssignment[]): Set<string> {
    const keys = new Set<string>();
    for (const assignment of assignments) {
      const role = this.roles.get(assignment.roleId);
      role?.permissionKeys.forEach((key) => keys.add(key));
    }
    return keys;
  }

  getRoleRegistry(): RoleRegistry {
    return this.roles;
  }
}
