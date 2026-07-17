/**
 * Base shape for every persisted entity in the Enterprise Foundation.
 *
 * Combines identity (UUID), audit fields, and soft delete fields. All future
 * models (Platform, Company, Branch, Department, Employee, ...) extend this.
 */

import type { UUID } from "./id";
import type { AuditFields } from "./audit";
import type { SoftDeleteFields } from "./soft-delete";

export interface BaseEntity extends AuditFields, SoftDeleteFields {
  id: UUID;
}
