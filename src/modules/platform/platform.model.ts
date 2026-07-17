/**
 * Platform module — top of the multi-tenant hierarchy.
 *
 * Platform -> Companies -> Branches -> Departments -> Employees
 *
 * This module owns the Platform model only. It never reaches down into
 * Company internals; Companies reference the Platform by `platformId`.
 */

import type { BaseEntity } from "@/core";

export interface Platform extends BaseEntity {
  name: string;
}
