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
 * ../modules/companies); Branches are delegated to the Branches module's
 * own `branchService` (see ../modules/branches).
 */

import { generateUUID, type UUID } from "../core/types";
import type { Platform } from "../modules/platform";
import type { Company } from "../modules/companies";
import { companyService } from "../modules/companies";
import type { Branch } from "../modules/branches";
import { branchService } from "../modules/branches";
import type { HealthStatus } from "../core/monitoring/types";
import type { Permission, Role } from "../core/authorization/types";
import type { FeatureFlag } from "../core/config/types";
import type { BillingPlan } from "../core/managers/billing-manager";
import type {
  ChannelSnapshot,
  OpenChannelInput,
  UpdateChannelInput,
} from "../core/managers/realtime-manager";
import {
  getConfigurationManager,
  getMonitoringManager,
  getSessionManager,
  getFeatureFlagManager,
  getBillingManager,
  getPermissionRegistry,
  getRoleRegistry,
  getRealtimeManager,
  getNotificationManager,
  getAuditManager,
} from "../core/bootstrap";
import type { AuditRecord } from "../core/managers/audit-manager";

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
  branchesCount: number;
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

  /** Every Branch on this Platform, across every Company, via the Branches module's own service. */
  listAllBranches(): Promise<Branch[]> {
    return branchService.listAllBranches();
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

  registerFeatureFlag(
    input: Pick<
      FeatureFlag,
      "displayName" | "key" | "description" | "enabled" | "scope" | "scopeTargetId" | "notes"
    >,
  ): FeatureFlag {
    const key = input.key.trim();
    if (!key) throw new Error("Feature flag key is required.");
    const manager = getFeatureFlagManager();
    if (manager.list().some((flag) => flag.key === key)) {
      throw new Error("A feature flag with this key already exists.");
    }
    const now = new Date();
    const flag: FeatureFlag = {
      ...input,
      key,
      id: generateUUID(),
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      deletedAt: null,
      deletedBy: null,
      archivedAt: null,
    };
    manager.register(flag);
    return flag;
  }

  isFeatureEnabled(key: string): boolean {
    return getFeatureFlagManager().isEnabled(key);
  }

  /** Toggle an existing Platform-scoped Feature Flag. No-op if the key is unknown. */
  setFeatureFlagEnabled(key: string, enabled: boolean): void {
    const manager = getFeatureFlagManager();
    const existing = manager.list().find((flag) => flag.key === key);
    if (!existing) return;
    manager.update(key, { enabled });
  }

  updateFeatureFlag(
    key: string,
    patch: Pick<FeatureFlag, "displayName" | "description" | "scope" | "scopeTargetId" | "notes">,
  ): FeatureFlag {
    return getFeatureFlagManager().update(key, patch);
  }

  archiveFeatureFlag(key: string): FeatureFlag {
    return getFeatureFlagManager().update(key, { archivedAt: new Date(), enabled: false });
  }

  restoreFeatureFlag(key: string): FeatureFlag {
    return getFeatureFlagManager().update(key, { archivedAt: null });
  }

  deleteFeatureFlag(key: string): void {
    getFeatureFlagManager().remove(key);
  }

  recordFeatureFlagAudit(
    action: string,
    userId: UUID,
    key: string,
    previousValue: unknown,
    newValue: unknown,
  ): void {
    getAuditManager().record(action, { userId, key, previousValue, newValue });
  }

  listFeatureFlagAudit(): AuditRecord[] {
    return getAuditManager()
      .list()
      .filter((record) => record.action.startsWith("feature-flag."));
  }

  getSubscriptionOverview(): SubscriptionOverview {
    return { plan: getBillingManager().getPlan(this.platform.id) };
  }

  setSubscriptionPlan(plan: BillingPlan): void {
    getBillingManager().setPlan(this.platform.id, plan);
  }

  getLicensingOverview(): SubscriptionOverview {
    return this.getSubscriptionOverview();
  }

  /** Billing plan for a specific Company (delegates to the same BillingManager, keyed by Company id). */
  getCompanyBillingPlan(companyId: UUID): BillingPlan {
    return getBillingManager().getPlan(companyId);
  }

  setCompanyBillingPlan(companyId: UUID, plan: BillingPlan): void {
    getBillingManager().setPlan(companyId, plan);
  }

  /** Every Realtime channel opened so far this session, with real (derived, not fabricated) stats. */
  listRealtimeChannels(): ChannelSnapshot[] {
    return getRealtimeManager().listChannels();
  }

  /** Opens a new Realtime channel (or reopens a closed one) — persisted for the session via the RealtimeManager singleton. */
  openRealtimeChannel(input: OpenChannelInput): ChannelSnapshot {
    return getRealtimeManager().openChannel(input);
  }

  updateRealtimeChannel(name: string, input: UpdateChannelInput): ChannelSnapshot {
    return getRealtimeManager().updateChannel(name, input);
  }

  closeRealtimeChannel(name: string): ChannelSnapshot {
    return getRealtimeManager().closeChannel(name);
  }

  deleteRealtimeChannel(name: string): void {
    getRealtimeManager().deleteChannel(name);
  }

  publishRealtimeEvent(name: string, payload: unknown): void {
    const channel = getRealtimeManager().getSnapshot(name);
    if (!channel || channel.closedAt) {
      throw new Error("The channel must be open before publishing an event.");
    }
    getRealtimeManager().channel(name).publish(payload);
  }

  /** Best-effort in-app notification via the Notification Manager. No external provider connected. */
  sendPlatformNotification(title: string, body: string, recipientId: UUID): Promise<void> {
    return getNotificationManager().notify({ title, body, recipientId });
  }

  listSentPlatformNotifications() {
    return getNotificationManager().listSent();
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
    const [health, users, companies, branches] = await Promise.all([
      this.getGlobalMonitoring(),
      this.listGlobalUsers(),
      this.listCompanies(),
      this.listAllBranches(),
    ]);
    return {
      platform: this.platform,
      companiesCount: companies.length,
      branchesCount: branches.length,
      activeUserCount: users.length,
      health,
    };
  }
}
