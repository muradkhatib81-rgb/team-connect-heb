/**
 * Repository Layer contract.
 *
 * Every module (Platform, Companies, Branches, Departments, Employees, ...)
 * exposes a repository that implements this interface instead of talking to
 * the Database Layer directly. This keeps data-access concerns isolated from
 * models and from any future business logic.
 */

import type { BaseEntity, UUID } from "../types";

export interface IRepository<T extends BaseEntity> {
  findById(id: UUID): Promise<T | null>;
  findAll(): Promise<T[]>;
  create(data: Omit<T, keyof BaseEntity>): Promise<T>;
  update(id: UUID, data: Partial<Omit<T, keyof BaseEntity>>): Promise<T>;
  softDelete(id: UUID): Promise<void>;
  restore(id: UUID): Promise<void>;
}
