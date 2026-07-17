/** Configuration Foundation — types only. */

import type { BaseEntity, UUID } from "../types";

export interface ApplicationSettings extends BaseEntity {
  key: string;
  value: unknown;
}

export interface PlatformSettings extends BaseEntity {
  platformId: UUID;
  key: string;
  value: unknown;
}

export interface CompanySettings extends BaseEntity {
  companyId: UUID;
  key: string;
  value: unknown;
}

export interface BranchSettings extends BaseEntity {
  branchId: UUID;
  key: string;
  value: unknown;
}

export interface FeatureFlag extends BaseEntity {
  key: string;
  enabled: boolean;
  scope: "platform" | "company" | "branch" | "department" | "employee";
  scopeTargetId: UUID | null;
}
