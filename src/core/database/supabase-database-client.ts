/**
 * Supabase-backed `IDatabaseClient` for the Platform Foundation layer.
 *
 * Maps camelCase entity fields ↔ snake_case columns, coerces timestamp
 * strings to `Date`, and routes the logical Foundation table name
 * `"branches"` to `company_branch_assignments` so operational
 * `public.branches` is never touched by assignment CRUD.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateUUID, type UUID } from "../types";
import type { IDatabaseClient, QueryFilter } from "./database-client";

const TABLE_MAP: Record<string, string> = {
  platforms: "platforms",
  companies: "companies",
  branches: "company_branch_assignments",
  company_branch_assignments: "company_branch_assignments",
};

const DATE_FIELDS = new Set([
  "createdAt",
  "updatedAt",
  "deletedAt",
  "archivedAt",
]);

function toSnakeCase(key: string): string {
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function toDbValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function fromDbValue(key: string, value: unknown): unknown {
  if (value == null) return value;
  if (DATE_FIELDS.has(key) && typeof value === "string") {
    return new Date(value);
  }
  return value;
}

function toDbRow(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    out[toSnakeCase(key)] = toDbValue(value);
  }
  return out;
}

function fromDbRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const camel = toCamelCase(key);
    out[camel] = fromDbValue(camel, value);
  }
  return out as T;
}

function resolveTable(logicalName: string): string {
  const physical = TABLE_MAP[logicalName];
  if (!physical) {
    throw new Error(
      `SupabaseDatabaseClient: unsupported Foundation table "${logicalName}".`,
    );
  }
  return physical;
}

export class SupabaseDatabaseClient implements IDatabaseClient {
  constructor(private readonly client: SupabaseClient) {}

  /** Untyped accessor — Foundation tables may not yet be in generated Database types. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private from(physical: string): any {
    return this.client.from(physical);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private applyFilter(query: any, filter: QueryFilter): any {
    let next = query;
    for (const [key, value] of Object.entries(filter)) {
      const column = toSnakeCase(key);
      if (value === null) {
        next = next.is(column, null);
      } else {
        next = next.eq(column, toDbValue(value));
      }
    }
    return next;
  }

  async findOne<T>(table: string, filter: QueryFilter): Promise<T | null> {
    const physical = resolveTable(table);
    let query = this.from(physical).select("*");
    query = this.applyFilter(query, filter);
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw new Error(`findOne(${table}): ${error.message}`);
    }
    if (!data) return null;
    return fromDbRow<T>(data as Record<string, unknown>);
  }

  async findMany<T>(table: string, filter: QueryFilter = {}): Promise<T[]> {
    const physical = resolveTable(table);
    let query = this.from(physical).select("*");
    query = this.applyFilter(query, filter);
    const { data, error } = await query;
    if (error) {
      throw new Error(`findMany(${table}): ${error.message}`);
    }
    return (data ?? []).map((row) => fromDbRow<T>(row as Record<string, unknown>));
  }

  async insert<T>(table: string, data: Partial<T>): Promise<T> {
    const physical = resolveTable(table);
    const now = new Date();
    const row = toDbRow({
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      deletedBy: null,
      ...(data as Record<string, unknown>),
    });
    const { data: inserted, error } = await this.from(physical)
      .insert(row)
      .select("*")
      .single();
    if (error) {
      throw new Error(`insert(${table}): ${error.message}`);
    }
    return fromDbRow<T>(inserted as Record<string, unknown>);
  }

  async update<T>(table: string, id: UUID, data: Partial<T>): Promise<T> {
    const physical = resolveTable(table);
    const patch = toDbRow({
      ...(data as Record<string, unknown>),
      updatedAt: new Date(),
    });
    const { data: updated, error } = await this.from(physical)
      .update(patch)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      throw new Error(`update(${table}): ${error.message}`);
    }
    return fromDbRow<T>(updated as Record<string, unknown>);
  }

  async remove(table: string, id: UUID): Promise<void> {
    const physical = resolveTable(table);
    const { error } = await this.from(physical).delete().eq("id", id);
    if (error) {
      throw new Error(`remove(${table}): ${error.message}`);
    }
  }
}
