/**
 * Branches module.
 *
 * Platform -> Companies -> Branches -> Departments -> Employees
 *
 * A Branch belongs to a Company via `companyId` only. This module is
 * deliberately isolated from the Companies module and from the Departments
 * module (see `modules/departments`) — neither imports the other's
 * internals; any relationship crosses module boundaries only through a
 * plain `UUID` reference.
 */

import type { BaseEntity, UUID } from "@/core";

export interface Branch extends BaseEntity {
  companyId: UUID;
  name: string;
}
