/**
 * Dashboard module.
 *
 * Dashboards exist at multiple levels of the hierarchy (Platform, Company,
 * Branch). This module is deliberately separated from the Companies module:
 * it never imports `Company` and never reaches into Company internals. It
 * only references the entity it is scoped to through `ownerId` (a plain
 * `UUID`) plus an explicit `scope` discriminator.
 */

import type { BaseEntity, UUID } from "@/core";

export type DashboardScope = "platform" | "company" | "branch" | "department";

export interface Dashboard extends BaseEntity {
  scope: DashboardScope;
  ownerId: UUID;
  name: string;
}
