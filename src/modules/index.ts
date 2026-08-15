/**
 * Enterprise Foundation — Modules Layer.
 *
 * Each module below is self-contained and communicates with the others only
 * through plain `UUID` references, never through direct imports of another
 * module's internals. This mirrors `docs/architecture/04-module-architecture.md`.
 */

export * as Platform from "./platform";
export * as Companies from "./companies";
export * as Ai from "./ai";
export * as Branches from "./branches";
export * as Departments from "./departments";
export * as Employees from "./employees";
export * as Dashboard from "./dashboard";
