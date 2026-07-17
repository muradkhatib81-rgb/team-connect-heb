/**
 * Platform Runtime — composition layer for the root of the multi-tenant
 * hierarchy (Platform -> Companies -> Branches -> Departments -> Employees).
 *
 * This is the Platform's own service facade. It reuses the existing
 * Enterprise Foundation exclusively (ManagerContainer, ConfigurationManager,
 * MonitoringManager, AuthorizationManager, SessionManager,
 * FeatureFlagManager, BillingManager, Role/Permission Registries) — it
 * creates no new abstractions and no Supabase connection. Companies are
 * delegated to the Companies module's own `companyService` (see
 * ../modules/companies); Branch runtime remains a stub (see
 * branch-context) for a future phase.
 */

import { generateUUID, type UUID } from "../core/types";
import type { Platform } from "../modules/platform";
import type { Company } from "../modules/companies";
import { companyService } from "../modules/companies";
import type { HealthStatus } from "../core/monitoring/types";
import type { Permission, Role } from "../core/authorization/types";
import type { FeatureFlag } from "../core/config/types";
import type { BillingPlan } from "../core/managers/billing-manager";
import {
  getConfigurationManager,
  getMonitoringManager,
  getSessionManager,
  getFeatureFlagManager,
  getBillingManager,
  getPermissionRegistry,
  getRoleRegistry,
} from "../core/bootstrap";

/**
 * Default active Platform. Stands in until a real Platform record can be
 * loaded from a connected database (Phase 4+); intentionally not read
 * through PlatformRepository here, since the repository's underlying
 * NotConnectedDatabaseClient throws by design and the active Platform must
 * always be available.
 */
export const DEFAULT_PLATFORM: Platform = (() => {
  const now = new Date();
  return {
    id: generateUUID(),
    name: "Default Platform",
    createdAt: now,
    updatedAt: now,
    createdBy: null,
    updatedBy: null,
    deletedAt: null,
    deletedBy: null,
  };
})();

export interface PlatformDashboardSnapshot {
  platform: Platform;
  companiesCount: number;
  activeUserCount: number;
  health: HealthStatus[];
}

export interface SubscriptionOverview {
  plan: BillingPlan;
}

/** Root-level Platform facade. One instance per active Platform. */
export class PlatformRuntimeService {
  constructor(private readonly platform: Platform = DEFAULT_PLATFORM) {}

  getActivePlatform(): Platform {
    return this.platform;
  }

  /** Companies belonging to this Platform, via the Companies module's own service. */
  listCompanies(): Promise<Company[]> {
    return companyService.listCompanies(this.platform.id);
  }

  getPlatformSetting<T>(key: string): T | undefined {
    return getConfigurationManager().get<T>(`platform:${this.platform.id}:${key}`);
  }

  setPlatformSetting<T>(key: string, value: T): void {
    getConfigurationManager().set(`platform:${this.platform.id}:${key}`, value);
  }

  getGlobalConfiguration<T>(key: string): T | undefined {
    return getConfigurationManager().get<T>(key);
  }

  setGlobalConfiguration<T>(key: string, value: T): void {
    getConfigurationManager().set(key, value);
  }

  async getGlobalMonitoring(): Promise<HealthStatus[]> {
    return getMonitoringManager().runHealthChecks();
  }

  async getPlatformStatus(): Promise<HealthStatus | undefined> {
    const results = await this.getGlobalMonitoring();
    return results.find((result) => result.target === "platform");
  }

  /**
   * Global Users, in Foundation terms: distinct subjects with an active
   * session (real logins are already bridged into SessionManager). This
   * intentionally does not duplicate the existing Platform Owners feature.
   */
  async listGlobalUsers(): Promise<UUID[]> {
    const sessions = await getSessionManager().listActiveSessions();
    return [...new Set(sessions.map((session) => session.userId))];
  }

  listGlobalRoles(): Role[] {
    return getRoleRegistry().list();
  }

  listGlobalPermissions(): Permission[] {
    return getPermissionRegistry().list();
  }

  listFeatureFlags(): FeatureFlag[] {
    return getFeatureFlagManager().list();
  }

  isFeatureEnabled(key: string): boolean {
    return getFeatureFlagManager().isEnabled(key);
  }

  getSubscriptionOverview(): SubscriptionOverview {
    return { plan: getBillingManager().getPlan(this.platform.id) };
  }

  getLicensingOverview(): SubscriptionOverview {
    return this.getSubscriptionOverview();
  }

  /**
   * Global Logs: log persistence/retrieval is not implemented in the
   * Foundation yet (loggers currently write to sinks only). Returns an
   * empty, honestly-typed result rather than fabricating history.
   */
  getGlobalLogsPreview(): [] {
    return [];
  }

  async getGlobalDashboard(): Promise<PlatformDashboardSnapshot> {
    const [health, users, companies] = await Promise.all([
      this.getGlobalMonitoring(),
      this.listGlobalUsers(),
      this.listCompanies(),
    ]);
    return {
      platform: this.platform,
      companiesCount: companies.length,
      activeUserCount: users.length,
      health,
    };
  }
}
