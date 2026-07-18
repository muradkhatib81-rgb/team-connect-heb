/**
 * Generic Repository Layer implementation.
 *
 * Concrete repositories (PlatformRepository, CompanyRepository,
 * BranchRepository, DepartmentRepository, EmployeeRepository, ...) extend
 * this class, supplying their table name and entity type. All persistence
 * calls go through the injected `IDatabaseClient` (Supabase-backed for the
 * Platform Foundation tables).
 */

import type { BaseEntity, UUID } from "../types";
import type { IDatabaseClient } from "../database/database-client";
import type { IRepository } from "./repository.interface";

export abstract class BaseRepository<T extends BaseEntity> implements IRepository<T> {
  protected constructor(
    protected readonly db: IDatabaseClient,
    protected readonly tableName: string,
  ) {}

  findById(id: UUID): Promise<T | null> {
    return this.db.findOne<T>(this.tableName, { id });
  }

  findAll(): Promise<T[]> {
    return this.db.findMany<T>(this.tableName, { deletedAt: null });
  }

  create(data: Omit<T, keyof BaseEntity>): Promise<T> {
    return this.db.insert<T>(this.tableName, data as Partial<T>);
  }

  update(id: UUID, data: Partial<Omit<T, keyof BaseEntity>>): Promise<T> {
    return this.db.update<T>(this.tableName, id, data as Partial<T>);
  }

  async softDelete(id: UUID): Promise<void> {
    await this.db.update<T>(this.tableName, id, { deletedAt: new Date() } as unknown as Partial<T>);
  }

  async restore(id: UUID): Promise<void> {
    await this.db.update<T>(this.tableName, id, { deletedAt: null } as unknown as Partial<T>);
  }
}
