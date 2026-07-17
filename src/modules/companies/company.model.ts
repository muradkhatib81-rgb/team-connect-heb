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

/** Operational lifecycle status of a Company. */
export type CompanyStatus = "active" | "inactive" | "suspended";

export interface Company extends BaseEntity {
  platformId: UUID;
  name: string;
  status: CompanyStatus;
  /** Non-null once the Company has been archived; independent of `status`. */
  archivedAt: Date | null;
  logoUrl: string | null;
  companyCode: string | null;
  legalName: string | null;
  taxNumber: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  currency: string;
  language: string;
  timeZone: string;
}

/** Sensible, honest defaults for a brand-new Company — nothing fabricated, just a starting point every field can override. */
export const DEFAULT_COMPANY_CURRENCY = "ILS";
export const DEFAULT_COMPANY_LANGUAGE = "he";
export const DEFAULT_COMPANY_TIME_ZONE = "Asia/Jerusalem";
