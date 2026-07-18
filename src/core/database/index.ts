import { supabase } from "@/integrations/supabase/client";
import { InMemoryDatabaseClient, type IDatabaseClient } from "./database-client";
import { SupabaseDatabaseClient } from "./supabase-database-client";

export * from "./database-client";
export * from "./supabase-database-client";

/**
 * Returns the database client for the Platform Foundation layer.
 *
 * When Supabase env is present (normal app runtime), this returns a
 * `SupabaseDatabaseClient` that persists platforms / companies /
 * company_branch_assignments. Falls back to in-memory only when env is
 * missing (e.g. isolated unit tests without Supabase).
 */
export function createDatabaseClient(): IDatabaseClient {
  try {
    return new SupabaseDatabaseClient(supabase);
  } catch {
    return new InMemoryDatabaseClient();
  }
}
