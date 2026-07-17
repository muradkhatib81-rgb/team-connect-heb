/** Authorization Foundation — types only. No business permissions defined yet. */

import type { BaseEntity, UUID } from "../types";

export type Scope = "platform" | "company" | "branch" | "department" | "employee";

export const SCOPE_HIERARCHY: readonly Scope[] = [
  "platform",
  "company",
  "branch",
  "department",
  "employee",
];

export interface Permission extends BaseEntity {
  key: string;
  description: string | null;
  scope: Scope;
}

export interface Role extends BaseEntity {
  name: string;
  scope: Scope;
  permissionKeys: string[];
}

export interface RoleAssignment extends BaseEntity {
  subjectId: UUID;
  roleId: UUID;
  scope: Scope;
  scopeTargetId: UUID | null;
}
