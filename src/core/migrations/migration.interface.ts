/**
 * Migrations structure (prepared, not active).
 *
 * This defines the shape future migrations will follow once a real database
 * connection exists. It intentionally holds no migration logic and is
 * unrelated to `supabase/migrations`, which remains the current, untouched
 * source of truth for the live database.
 */

import type { UUID } from "../types";

export interface Migration {
  id: UUID;
  name: string;
  up(): Promise<void>;
  down(): Promise<void>;
}

/**
 * Registry for future migrations. Left empty on purpose: no migration is
 * defined or executed as part of the Enterprise Foundation.
 */
export const migrations: readonly Migration[] = [];
