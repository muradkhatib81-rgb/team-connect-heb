/** Monitoring Manager — facade over the Health Check Registry (see ../monitoring). */

import { BaseManager } from "./manager.interface";
import { HealthCheckRegistry } from "../monitoring/health-registry";
import type { IHealthCheck } from "../monitoring/health-check.interface";

export class MonitoringManager extends BaseManager {
  constructor(private readonly registry: HealthCheckRegistry = new HealthCheckRegistry()) {
    super("monitoring-manager");
  }

  registerCheck(check: IHealthCheck): void {
    this.registry.register(check);
  }

  runHealthChecks() {
    return this.registry.runAll();
  }
}
