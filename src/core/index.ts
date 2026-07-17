/**
 * Enterprise Foundation — Core Layer.
 *
 * Barrel export for the shared, cross-module abstractions: UUID/audit/soft
 * delete types, the Database Layer, the Repository Layer, and the migrations
 * structure. Nothing in this layer connects to Supabase or any live data
 * source.
 */

export * from "./types";
export * from "./database";
export * from "./repository";
export * from "./migrations";
