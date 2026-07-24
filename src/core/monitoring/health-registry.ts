/** Health Check Registry — register/run checks, aggregate results. No business logic. */

import { generateUUID } from "../types";
import type { HealthCheckOutcome, IHealthCheck } from "./health-check.interface";
import type { HealthState, HealthStatus, HealthTarget } from "./types";

function normalizeOutcome(result: HealthCheckOutcome): {
  state: HealthState;
  message: string | null;
} {
  if (typeof result === "string") {
    return { state: result, message: null };
  }
  return { state: result.state, message: result.message ?? null };
}

export class HealthCheckRegistry {
  private readonly checks = new Map<HealthTarget, IHealthCheck>();

  register(check: IHealthCheck): void {
    this.checks.set(check.target, check);
  }

  async runAll(): Promise<HealthStatus[]> {
    const now = new Date();
    const results: HealthStatus[] = [];
    for (const check of this.checks.values()) {
      let state: HealthState = "unknown";
      let message: string | null = null;
      try {
        const normalized = normalizeOutcome(await check.check());
        state = normalized.state;
        message = normalized.message;
      } catch (err) {
        state = "unknown";
        message = err instanceof Error ? err.message : null;
      }
      results.push({
        id: generateUUID(),
        target: check.target,
        targetId: null,
        state,
        checkedAt: now,
        message,
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

