/**
 * UUID support for the Enterprise Foundation.
 *
 * All entities across the multi-tenant hierarchy (Platform, Company, Branch,
 * Department, Employee) are identified by UUID. This module provides a
 * nominal `UUID` type plus small helpers so identifiers cannot be confused
 * with arbitrary strings at compile time.
 *
 * This is a pure type/utility module. It has no dependency on Supabase or
 * any database connection.
 */

export type UUID = string & { readonly __uuidBrand: unique symbol };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(value: string): value is UUID {
  return UUID_PATTERN.test(value);
}

export function toUUID(value: string): UUID {
  if (!isUUID(value)) {
    throw new Error(`Invalid UUID: "${value}"`);
  }
  return value;
}

/**
 * Generates a new UUID using the platform's native crypto implementation.
 * No external dependency is required.
 */
export function generateUUID(): UUID {
  return crypto.randomUUID() as UUID;
}
