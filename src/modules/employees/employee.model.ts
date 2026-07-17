/**
 * Employees module — bottom of the multi-tenant hierarchy.
 *
 * Platform -> Companies -> Branches -> Departments -> Employees
 *
 * An Employee belongs to a Department (and, transitively, a Branch) via
 * plain `UUID` references only. This module does not import the Departments
 * module's internals.
 */

import type { BaseEntity, UUID } from "@/core";

export interface Employee extends BaseEntity {
  departmentId: UUID;
  branchId: UUID;
  fullName: string;
}
