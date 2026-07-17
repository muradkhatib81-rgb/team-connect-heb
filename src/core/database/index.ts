import { NotConnectedDatabaseClient, type IDatabaseClient } from "./database-client";

export * from "./database-client";

/**
 * Returns the database client for the current environment.
 *
 * Today this always resolves to the placeholder `NotConnectedDatabaseClient`.
 * When Supabase integration is introduced, this factory becomes the single
 * place where a real client is wired in, without touching the Repository
 * Layer or any Model.
 */
export function createDatabaseClient(): IDatabaseClient {
  return new NotConnectedDatabaseClient();
}
