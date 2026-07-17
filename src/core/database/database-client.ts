/**
 * Database Layer abstraction.
 *
 * `IDatabaseClient` is the boundary between the Repository Layer and any
 * concrete data provider. No concrete provider is implemented here: there is
 * no Supabase client, no connection string, no key, and no URL in this file.
 *
 * `NotConnectedDatabaseClient` is a placeholder implementation that keeps the
 * abstraction usable end-to-end (types, layering, wiring) while making it
 * explicit that no real data access exists yet.
 *
 * `InMemoryDatabaseClient` is a real, functional implementation of the same
 * interface: it lets modules (e.g. Companies) perform genuine CRUD from the
 * UI without any external dependency. Data lives only in process memory and
 * resets on reload/restart — it is not a substitute for a persisted
 * database. A future Supabase-backed implementation can be introduced later
 * by implementing this same interface, without any change to the Repository
 * Layer or Models above it.
 */

import { generateUUID, type UUID } from "../types";

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

/**
 * In-memory `IDatabaseClient`. Each table is a plain `Map<UUID, row>`; rows
 * are generic records that already look like `BaseEntity` (id + audit +
 * soft-delete fields) once `insert()` has run. No filtering logic beyond
 * strict equality is implemented — enough for the Repository Layer's
 * `{ id }` / `{ deletedAt: null }` lookups, nothing business-specific.
 */
export class InMemoryDatabaseClient implements IDatabaseClient {
  private readonly tables = new Map<string, Map<UUID, Record<string, unknown>>>();

  private table(name: string): Map<UUID, Record<string, unknown>> {
    let table = this.tables.get(name);
    if (!table) {
      table = new Map();
      this.tables.set(name, table);
    }
    return table;
  }

  private matches(row: Record<string, unknown>, filter: QueryFilter): boolean {
    return Object.entries(filter).every(([key, value]) => row[key] === value);
  }

  async findOne<T>(table: string, filter: QueryFilter): Promise<T | null> {
    const row = [...this.table(table).values()].find((candidate) =>
      this.matches(candidate, filter),
    );
    return (row as T | undefined) ?? null;
  }

  async findMany<T>(table: string, filter: QueryFilter = {}): Promise<T[]> {
    return [...this.table(table).values()].filter((row) => this.matches(row, filter)) as T[];
  }

  async insert<T>(table: string, data: Partial<T>): Promise<T> {
    const now = new Date();
    const row: Record<string, unknown> = {
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      deletedBy: null,
      ...data,
    };
    this.table(table).set(row.id as UUID, row);
    return row as T;
  }

  async update<T>(table: string, id: UUID, data: Partial<T>): Promise<T> {
    const rows = this.table(table);
    const existing = rows.get(id);
    if (!existing) {
      throw new Error(`No row with id "${id}" in table "${table}".`);
    }
    const updated = { ...existing, ...data, updatedAt: new Date() };
    rows.set(id, updated);
    return updated as T;
  }

  async remove(table: string, id: UUID): Promise<void> {
    this.table(table).delete(id);
  }
}
