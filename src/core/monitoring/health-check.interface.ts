import type { HealthState, HealthTarget } from "./types";

export type HealthCheckOutcome =
  | HealthState
  | { state: HealthState; message?: string | null };

export interface IHealthCheck {
  readonly target: HealthTarget;
  check(): Promise<HealthCheckOutcome>;
}

