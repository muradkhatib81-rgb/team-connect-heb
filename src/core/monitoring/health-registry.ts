/** Health Check Registry — register/run checks, aggregate results. No business logic. */

import { generateUUID } from "../types";
import type { IHealthCheck } from "./health-check.interface";
import type { HealthState, HealthStatus, HealthTarget } from "./types";

export class HealthCheckRegistry {
  private readonly checks = new Map<HealthTarget, IHealthCheck>();

  register(check: IHealthCheck): void {
    this.checks.set(check.target, check);
  }

  async runAll(): Promise<HealthStatus[]> {
    const now = new Date();
    const results: HealthStatus[] = [];
    for (const check of this.checks.values()) {
      let state: HealthState;
      try {
        state = await check.check();
      } catch {
        state = "unknown";
      }
      results.push({
        id: generateUUID(),
        target: check.target,
        targetId: null,
        state,
        checkedAt: now,
        message: null,
        createdAt: now,
        updatedAt: now,
        createdBy: null,
        updatedBy: null,
        deletedAt: null,
        deletedBy: null,
      });
    }
    return results;
  }
}
