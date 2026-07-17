/**
 * Database Layer abstraction.
 *
 * `IDatabaseClient` is the boundary between the Repository Layer and any
 * concrete data provider. No concrete provider is implemented here: there is
 * no Supabase client, no connection string, no key, and no URL in this file.
 *
 * `NotConnectedDatabaseClient` is a placeholder implementation that keeps the
 * abstraction usable end-to-end (types, layering, wiring) while making it
 * explicit that no real data access exists yet. A future Supabase-backed
 * implementation can be introduced later by implementing this same
 * interface, without any change to the Repository Layer or Models above it.
 */

import type { UUID } from "../types";

export interface QueryFilter {
  [field: string]: unknown;
}

export interface IDatabaseClient {
  findOne<T>(table: string, filter: QueryFilter): Promise<T | null>;
  findMany<T>(table: string, filter?: QueryFilter): Promise<T[]>;
  insert<T>(table: string, data: Partial<T>): Promise<T>;
  update<T>(table: string, id: UUID, data: Partial<T>): Promise<T>;
  remove(table: string, id: UUID): Promise<void>;
}

export class NotConnectedDatabaseClient implements IDatabaseClient {
  async findOne<T>(_table: string, _filter: QueryFilter): Promise<T | null> {
    return this.notConnected();
  }

  async findMany<T>(_table: string, _filter?: QueryFilter): Promise<T[]> {
    return this.notConnected();
  }

  async insert<T>(_table: string, _data: Partial<T>): Promise<T> {
    return this.notConnected();
  }

  async update<T>(_table: string, _id: UUID, _data: Partial<T>): Promise<T> {
    return this.notConnected();
  }

  async remove(_table: string, _id: UUID): Promise<void> {
    return this.notConnected();
  }

  private notConnected(): never {
    throw new Error(
      "Database Layer is prepared but not connected. Supabase integration is " +
        "intentionally deferred to a future phase (see docs/architecture/08-roadmap.md).",
    );
  }
}
