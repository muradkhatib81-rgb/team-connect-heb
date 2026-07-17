import { InMemoryDatabaseClient, type IDatabaseClient } from "./database-client";

export * from "./database-client";

/**
 * Returns the database client for the current environment.
 *
 * Today this resolves to `InMemoryDatabaseClient` — a real, working
 * implementation with no external dependency, so modules can perform
 * genuine CRUD from the UI. Data is process-local and non-persistent.
 * When Supabase integration is introduced, this factory becomes the single
 * place where a real client is wired in, without touching the Repository
 * Layer or any Model.
 */
export function createDatabaseClient(): IDatabaseClient {
  return new InMemoryDatabaseClient();
}
