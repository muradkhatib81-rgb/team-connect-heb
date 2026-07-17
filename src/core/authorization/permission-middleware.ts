/** Permission Middleware — guard clause factory. No business permissions wired in yet. */

import type { UUID } from "../types";
import type { PermissionResolver } from "./permission-resolver";
import type { Scope } from "./types";

export class PermissionDeniedError extends Error {
  constructor(permissionKey: string) {
    super(`Permission denied: ${permissionKey}`);
  }
}

export function requirePermission(
  resolver: PermissionResolver,
  permissionKey: string,
  scope: Scope,
) {
  return async (subjectId: UUID): Promise<void> => {
    const allowed = await resolver.hasPermission(subjectId, permissionKey, scope);
    if (!allowed) throw new PermissionDeniedError(permissionKey);
  };
}
