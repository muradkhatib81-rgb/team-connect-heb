/** Permission Engine — evaluates whether a set of granted keys satisfies a permission at a scope. */

import { SCOPE_HIERARCHY, type Scope } from "./types";

export class PermissionEngine {
  /** Platform -> Company -> Branch -> Department -> Employee: broader scopes imply narrower ones. */
  scopeIncludes(grantedScope: Scope, requestedScope: Scope): boolean {
    return SCOPE_HIERARCHY.indexOf(grantedScope) <= SCOPE_HIERARCHY.indexOf(requestedScope);
  }

  evaluate(grantedKeys: ReadonlySet<string>, permissionKey: string): boolean {
    return grantedKeys.has(permissionKey);
  }
}
