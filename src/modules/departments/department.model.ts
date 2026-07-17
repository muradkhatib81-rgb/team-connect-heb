/**
 * Departments module.
 *
 * Platform -> Companies -> Branches -> Departments -> Employees
 *
 * A Department belongs to a Branch via `branchId` only. This module is
 * deliberately isolated from the Branches module and from the Employees
 * module (see `modules/employees`) — neither imports the other's internals;
 * any relationship crosses module boundaries only through a plain `UUID`
 * reference.
 */

import type { BaseEntity, UUID } from "@/core";

export interface Department extends BaseEntity {
  branchId: UUID;
  name: string;
}
