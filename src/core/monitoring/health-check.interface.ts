import type { HealthState, HealthTarget } from "./types";

export interface IHealthCheck {
  readonly target: HealthTarget;
  check(): Promise<HealthState>;
}
