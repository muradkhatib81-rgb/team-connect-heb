/**
 * Companies module.
 *
 * Platform -> Companies -> Branches -> Departments -> Employees
 *
 * A Company belongs to a Platform via `platformId` only. This module is
 * deliberately isolated from the Branches module (see `modules/branches`)
 * and from the Dashboard module (see `modules/dashboard`) — neither imports
 * the other's internals; any relationship crosses module boundaries only
 * through a plain `UUID` reference.
 */

import type { BaseEntity, UUID } from "@/core";

export interface Company extends BaseEntity {
  platformId: UUID;
  name: string;
}
