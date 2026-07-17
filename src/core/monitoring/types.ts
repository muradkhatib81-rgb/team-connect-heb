/** Monitoring Foundation — models only. No UI, no dashboard. */

import type { BaseEntity, UUID } from "../types";

export type HealthState = "healthy" | "degraded" | "down" | "unknown";

export type HealthTarget =
  | "platform"
  | "company"
  | "branch"
  | "department"
  | "database"
  | "storage"
  | "realtime"
  | "api"
  | "queue"
  | "sync"
  | "configuration"
  | "managers";

export type Severity = "info" | "warning" | "error" | "critical";

export interface HealthStatus extends BaseEntity {
  target: HealthTarget;
  targetId: UUID | null;
  state: HealthState;
  checkedAt: Date;
  message: string | null;
}

export interface ServiceStatus extends BaseEntity {
  serviceName: string;
  state: HealthState;
  lastCheckedAt: Date;
}

export interface PlatformStatus extends BaseEntity {
  platformId: UUID;
  state: HealthState;
}

export interface CompanyStatus extends BaseEntity {
  companyId: UUID;
  state: HealthState;
}

export interface BranchStatus extends BaseEntity {
  branchId: UUID;
  state: HealthState;
}

export interface DepartmentStatus extends BaseEntity {
  departmentId: UUID;
  state: HealthState;
}

export interface Incident extends BaseEntity {
  title: string;
  severity: Severity;
  target: HealthTarget;
  resolvedAt: Date | null;
}

export interface Alert extends BaseEntity {
  title: string;
  severity: Severity;
  target: HealthTarget;
  acknowledgedAt: Date | null;
}

export interface Warning extends BaseEntity {
  message: string;
  source: string;
}

export interface ErrorEvent extends BaseEntity {
  message: string;
  stack: string | null;
  source: string;
}

export interface PerformanceMetrics extends BaseEntity {
  source: string;
  cpuUsagePercent: number | null;
  memoryUsageMb: number | null;
  latencyMs: number | null;
}

export interface Heartbeat extends BaseEntity {
  source: string;
  timestamp: Date;
}
