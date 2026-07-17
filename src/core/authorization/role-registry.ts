/** Role Registry — in-memory catalog of role templates. */

import type { UUID } from "../types";
import type { Role } from "./types";

export class RoleRegistry {
  private readonly roles = new Map<UUID, Role>();

  register(role: Role): void {
    this.roles.set(role.id, role);
  }

  get(id: UUID): Role | undefined {
    return this.roles.get(id);
  }

  list(): Role[] {
    return [...this.roles.values()];
  }
}
