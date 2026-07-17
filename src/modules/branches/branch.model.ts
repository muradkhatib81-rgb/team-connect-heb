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
 *
 * Important: a Platform `Branch` is an ASSIGNMENT of an existing, real
 * (single-tenant) Supabase `branches` row to a Company — never a new,
 * separate branch. `sourceBranchId` is that real row's id and is what
 * actually enters "Branch Mode" (see `platform/branch-context.tsx`), so
 * every existing relationship of that real branch (Employees, Departments,
 * Schedules, Attendance, Tasks, Messages, Reports, Settings, ...) keeps
 * working unchanged. `name`/`code`/`address`/`isActive` are a denormalized
 * snapshot taken at assignment time (and refreshable via
 * `BranchService.refreshBranchSnapshot`) purely so the Platform UI can list
 * Branches without an extra round-trip; they are never the source of truth.
 */

import type { BaseEntity, UUID } from "@/core";

export interface Branch extends BaseEntity {
  companyId: UUID;
  /** Id of the real Supabase `branches` row this assignment points to. */
  sourceBranchId: string;
  name: string;
  code: string | null;
  address: string | null;
  isActive: boolean;
}
