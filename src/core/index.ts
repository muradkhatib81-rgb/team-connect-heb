/**
 * Enterprise Foundation — Core Layer.
 *
 * Barrel export for the shared, cross-module abstractions: UUID/audit/soft
 * delete types, the Database Layer, the Repository Layer, the migrations
 * structure, Authentication/Authorization, Core Managers, Monitoring, Logging
 * and Configuration. Nothing in this layer connects to Supabase or any live
 * data source.
 */

export * from "./types";
export * from "./database";
export * from "./repository";
export * from "./migrations";
export * from "./auth";
export * from "./authorization";
export * from "./managers";
export * from "./monitoring";
export * from "./logging";
export * from "./config";
