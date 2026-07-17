/**
 * Audit fields shared by every entity in the Enterprise Foundation.
 *
 * These fields record who created/updated a record and when, matching the
 * auditing rules defined in `docs/architecture/05-database-philosophy.md`.
 */

import type { UUID } from "./id";

export interface AuditFields {
  createdAt: Date;
  updatedAt: Date;
  createdBy: UUID | null;
  updatedBy: UUID | null;
}
