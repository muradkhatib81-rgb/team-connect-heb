/** Authorization Manager — facade over the Authorization engine (see ../authorization). */

import type { UUID } from "../types";
import type { PermissionResolver } from "../authorization/permission-resolver";
import type { Scope } from "../authorization/types";

export class AuthorizationManager {
  constructor(private readonly resolver: PermissionResolver) {}

  async can(subjectId: UUID, permissionKey: string, scope: Scope): Promise<boolean> {
    return this.resolver.hasPermission(subjectId, permissionKey, scope);
  }
}
