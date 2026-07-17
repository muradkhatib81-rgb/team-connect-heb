/** Permission Registry — in-memory catalog. Empty by default; no business permissions yet. */

import type { Permission } from "./types";

export class PermissionRegistry {
  private readonly permissions = new Map<string, Permission>();

  register(permission: Permission): void {
    this.permissions.set(permission.key, permission);
  }

  get(key: string): Permission | undefined {
    return this.permissions.get(key);
  }

  list(): Permission[] {
    return [...this.permissions.values()];
  }
}
