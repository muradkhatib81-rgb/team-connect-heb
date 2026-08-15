/**
 * Foundation Bootstrap — Integration Phase.
 *
 * Wires the existing Enterprise Foundation (auth, authorization, managers,
 * monitoring, logging, config) together behind the ManagerContainer, and
 * exposes lifecycle + accessor functions for the application to depend on.
 *
 * This module creates instances and wires the Foundation database client
 * (Supabase-backed for Platform → Company → Branch). It does not duplicate
 * operational Supabase access used by Departments/Employees/etc.
 */

import { generateUUID, isUUID, type UUID } from "./types";
import { createDatabaseClient, type IDatabaseClient } from "./database";
import { ManagerContainer } from "./managers/container";
import type { IManager } from "./managers/manager.interface";
import { RealtimeManager } from "./managers/realtime-manager";
import { OfflineManager } from "./managers/offline-manager";
import { NotificationManager } from "./managers/notification-manager";
import { StorageManager } from "./managers/storage-manager";
import { ConfigurationManager } from "./managers/configuration-manager";
import { FeatureFlagManager } from "./managers/feature-flag-manager";
import { AuditManager } from "./managers/audit-manager";
import { MonitoringManager } from "./managers/monitoring-manager";
import { IntegrationManager } from "./managers/integration-manager";
import { DeviceManager } from "./managers/device-manager";
import { BillingManager } from "./managers/billing-manager";
import { ResourceManager } from "./managers/resource-manager";

import { SessionManager } from "./auth/session-manager";
import { AuthenticationManager } from "./auth/authentication-manager";
import { AuthorizationManager } from "./auth/authorization-manager";
import type { DeviceInfo } from "./auth/types";
import { RoleEngine } from "./authorization/role-engine";
import { PermissionEngine } from "./authorization/permission-engine";
import { PermissionResolver } from "./authorization/permission-resolver";
import { PermissionRegistry } from "./authorization/permission-registry";
import { RoleRegistry } from "./authorization/role-registry";

import { CentralLogger } from "./logging/central-logger";
import { AuditLogger } from "./logging/audit-logger";
import { SecurityLogger } from "./logging/security-logger";
import { SystemLogger } from "./logging/system-logger";
import { RealtimeLogger } from "./logging/realtime-logger";
import { PerformanceLogger } from "./logging/performance-logger";
import { ErrorLogger } from "./logging/error-logger";

import { getEnvironment } from "./config/environment";
import type { HealthCheckOutcome, IHealthCheck } from "./monitoring/health-check.interface";
import type { HealthTarget } from "./monitoring/types";
import {
  AsyncHealthCheck,
  probeApi,
  probeConfiguration,
  probeDatabase,
  probeRealtime,
  probeStorage,
  probeSync,
} from "./monitoring/platform-probes";

const TOKENS = {
  databaseClient: "database-client",
  realtime: "realtime-manager",
  offline: "offline-manager",
  notification: "notification-manager",
  storage: "storage-manager",
  configuration: "configuration-manager",
  featureFlag: "feature-flag-manager",
  audit: "audit-manager",
  monitoring: "monitoring-manager",
  integration: "integration-manager",
  device: "device-manager",
  billing: "billing-manager",
  resource: "resource-manager",
  sessionManager: "session-manager",
  authenticationManager: "authentication-manager",
  authorizationManager: "authorization-manager",
  roleEngine: "role-engine",
  permissionEngine: "permission-engine",
  permissionResolver: "permission-resolver",
  permissionRegistry: "permission-registry",
  roleRegistry: "role-registry",
  centralLogger: "central-logger",
  auditLogger: "audit-logger",
  securityLogger: "security-logger",
  systemLogger: "system-logger",
  realtimeLogger: "realtime-logger",
  performanceLogger: "performance-logger",
  errorLogger: "error-logger",
} as const;

class SimpleHealthCheck implements IHealthCheck {
  constructor(
    public readonly target: HealthTarget,
    private readonly probe: () => HealthCheckOutcome | Promise<HealthCheckOutcome>,
  ) {}
  async check(): Promise<HealthCheckOutcome> {
    return this.probe();
  }
}

const container = new ManagerContainer();
container.register(TOKENS.databaseClient, createDatabaseClient());
const runtimeManagers: IManager[] = [];
let initialized = false;
let inactivitySweepHandle: ReturnType<typeof setInterval> | undefined;

function registerManager<T extends IManager>(token: string, manager: T): T {
  container.register(token, manager);
  runtimeManagers.push(manager);
  return manager;
}

const permissionResolver = new PermissionResolver();
container.register(TOKENS.permissionResolver, permissionResolver);
container.register(TOKENS.roleEngine, new RoleEngine());
container.register(TOKENS.permissionEngine, new PermissionEngine());
container.register(TOKENS.permissionRegistry, new PermissionRegistry());
container.register(TOKENS.roleRegistry, new RoleRegistry());

const sessionManager = new SessionManager();
container.register(TOKENS.sessionManager, sessionManager);
container.register(
  TOKENS.authenticationManager,
  new AuthenticationManager(undefined, sessionManager),
);
container.register(TOKENS.authorizationManager, new AuthorizationManager(permissionResolver));

registerManager(TOKENS.realtime, new RealtimeManager());
registerManager(TOKENS.offline, new OfflineManager());
registerManager(TOKENS.notification, new NotificationManager());
registerManager(TOKENS.storage, new StorageManager());
const configurationManager = registerManager(TOKENS.configuration, new ConfigurationManager());
registerManager(TOKENS.featureFlag, new FeatureFlagManager());
registerManager(TOKENS.audit, new AuditManager());
const monitoringManager = registerManager(TOKENS.monitoring, new MonitoringManager());
registerManager(TOKENS.integration, new IntegrationManager());
registerManager(TOKENS.device, new DeviceManager());
registerManager(TOKENS.billing, new BillingManager());
registerManager(TOKENS.resource, new ResourceManager());

container.register(TOKENS.centralLogger, new CentralLogger());
container.register(TOKENS.auditLogger, new AuditLogger());
container.register(TOKENS.securityLogger, new SecurityLogger());
container.register(TOKENS.systemLogger, new SystemLogger());
container.register(TOKENS.realtimeLogger, new RealtimeLogger());
container.register(TOKENS.performanceLogger, new PerformanceLogger());
container.register(TOKENS.errorLogger, new ErrorLogger());

configurationManager.set("environment", getEnvironment());

// Part 3 — Feature Flags: seed a small set of real, platform-scoped flags
// so the Feature Flag Manager has something genuine to list/toggle from
// the Platform UI. Nothing here gates behavior yet — flipping a flag only
// changes what `featureFlagManager.isEnabled(key)` reports, honestly.
const featureFlagManager = container.resolve<FeatureFlagManager>(TOKENS.featureFlag);
for (const flag of [
  { key: "platform.maintenance_mode", enabled: false },
  { key: "platform.global_analytics", enabled: true },
  { key: "platform.beta_billing", enabled: false },
  { key: "platform.beta_ai", enabled: true },
] as const) {
  featureFlagManager.register({
    id: generateUUID(),
    displayName: flag.key,
    key: flag.key,
    description: "",
    enabled: flag.enabled,
    scope: "platform",
    scopeTargetId: null,
    notes: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
  });
}

// Part 4 — Monitoring Integration: real read-only probes where possible.
// Queue stays "unknown" (no job queue wired). No writes / no permission changes.
monitoringManager.registerCheck(new AsyncHealthCheck("configuration", probeConfiguration));
monitoringManager.registerCheck(new AsyncHealthCheck("api", probeApi));
monitoringManager.registerCheck(new AsyncHealthCheck("database", probeDatabase));
monitoringManager.registerCheck(new AsyncHealthCheck("storage", probeStorage));
monitoringManager.registerCheck(new AsyncHealthCheck("realtime", probeRealtime));
monitoringManager.registerCheck(new AsyncHealthCheck("sync", probeSync));
monitoringManager.registerCheck(
  new SimpleHealthCheck("platform", async () => {
    const cfg = await probeConfiguration();
    const cfgState = typeof cfg === "string" ? cfg : cfg.state;
    if (cfgState === "down") {
      return { state: "down" as const, message: "תצורת הפלטפורמה חסרה" };
    }
    if (runtimeManagers.length === 0) {
      return { state: "down" as const, message: "לא נרשמו managers" };
    }
    return { state: "healthy" as const, message: "פלטפורמה פעילה" };
  }),
);
monitoringManager.registerCheck(
  new SimpleHealthCheck("queue", () => ({
    state: "unknown" as const,
    message: "אין תור עבודות מחובר בפלטפורמה",
  })),
);
monitoringManager.registerCheck(
  new SimpleHealthCheck("managers", () =>
    runtimeManagers.length > 0
      ? { state: "healthy" as const, message: `${runtimeManagers.length} managers` }
      : { state: "down" as const, message: "לא נרשמו managers" },
  ),
);

/** Part 6 — Runtime: start every registered manager exactly once. */
export async function initializeFoundation(): Promise<void> {
  if (initialized) return;
  initialized = true;
  for (const manager of runtimeManagers) {
    await manager.init();
  }
  inactivitySweepHandle = setInterval(
    () => {
      void sessionManager.cleanupInactiveSessions();
    },
    5 * 60 * 1000,
  );
  container.resolve<CentralLogger>(TOKENS.centralLogger).info("Foundation initialized", {
    managers: runtimeManagers.length,
    environment: getEnvironment(),
  });
}

/** Part 6 — Runtime: stop every registered manager exactly once. */
export async function shutdownFoundation(): Promise<void> {
  if (!initialized) return;
  initialized = false;
  if (inactivitySweepHandle) clearInterval(inactivitySweepHandle);
  for (const manager of runtimeManagers) {
    await manager.dispose();
  }
  container.resolve<CentralLogger>(TOKENS.centralLogger).info("Foundation shut down");
}

export function getManagerContainer(): ManagerContainer {
  return container;
}

export function getDatabaseClient(): IDatabaseClient {
  return container.resolve(TOKENS.databaseClient);
}

export function getCentralLogger(): CentralLogger {
  return container.resolve(TOKENS.centralLogger);
}
export function getAuditLogger(): AuditLogger {
  return container.resolve(TOKENS.auditLogger);
}
export function getSecurityLogger(): SecurityLogger {
  return container.resolve(TOKENS.securityLogger);
}
export function getSystemLogger(): SystemLogger {
  return container.resolve(TOKENS.systemLogger);
}
export function getRealtimeLogger(): RealtimeLogger {
  return container.resolve(TOKENS.realtimeLogger);
}
export function getPerformanceLogger(): PerformanceLogger {
  return container.resolve(TOKENS.performanceLogger);
}
export function getErrorLogger(): ErrorLogger {
  return container.resolve(TOKENS.errorLogger);
}

export function getSessionManager(): SessionManager {
  return container.resolve(TOKENS.sessionManager);
}
export function getAuthenticationManager(): AuthenticationManager {
  return container.resolve(TOKENS.authenticationManager);
}
export function getAuthorizationManager(): AuthorizationManager {
  return container.resolve(TOKENS.authorizationManager);
}
export function getMonitoringManager(): MonitoringManager {
  return container.resolve(TOKENS.monitoring);
}
export function getConfigurationManager(): ConfigurationManager {
  return container.resolve(TOKENS.configuration);
}
export function getFeatureFlagManager(): FeatureFlagManager {
  return container.resolve(TOKENS.featureFlag);
}
export function getBillingManager(): BillingManager {
  return container.resolve(TOKENS.billing);
}
export function getRealtimeManager(): RealtimeManager {
  return container.resolve(TOKENS.realtime);
}
export function getNotificationManager(): NotificationManager {
  return container.resolve(TOKENS.notification);
}
export function getAuditManager(): AuditManager {
  return container.resolve(TOKENS.audit);
}
export function getPermissionRegistry(): PermissionRegistry {
  return container.resolve(TOKENS.permissionRegistry);
}
export function getRoleRegistry(): RoleRegistry {
  return container.resolve(TOKENS.roleRegistry);
}

function buildDeviceInfo(): DeviceInfo {
  const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : null;
  return { deviceId: generateUUID(), userAgent, ipAddress: null };
}

/**
 * Part 1 — Authentication Integration.
 *
 * Best-effort bridge from the existing (Supabase-backed) auth flow into the
 * Foundation's SessionManager, so session validation / 12h expiration /
 * device sessions begin operating for real logged-in users. This never
 * throws and never alters the caller's auth outcome.
 */
export async function syncFoundationSession(userId: string): Promise<void> {
  try {
    const subjectId: UUID = isUUID(userId) ? userId : generateUUID();
    const sessions = await sessionManager.getDeviceSessions(subjectId);
    const existing = sessions.find((session) => session.status === "active");
    if (existing) {
      await sessionManager.touchSession(existing.id);
    } else {
      await sessionManager.createSession(subjectId, buildDeviceInfo());
    }
  } catch {
    // Best-effort only; authentication itself must never depend on this.
  }
}
