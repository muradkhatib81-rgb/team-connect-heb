/**
 * Soft delete support for the Enterprise Foundation.
 *
 * Records are never physically removed. They are marked as deleted via
 * `deletedAt`/`deletedBy`, matching the soft delete rules defined in
 * `docs/architecture/05-database-philosophy.md`.
 */

import type { UUID } from "./id";

export interface SoftDeleteFields {
  deletedAt: Date | null;
  deletedBy: UUID | null;
}

export function isSoftDeleted(entity: SoftDeleteFields): boolean {
  return entity.deletedAt !== null;
}
