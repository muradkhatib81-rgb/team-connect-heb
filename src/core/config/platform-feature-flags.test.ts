import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PLATFORM_FEATURE_FLAGS,
  RETIRED_PLATFORM_FEATURE_FLAG_KEYS,
  canAccessAppDuringMaintenance,
  canSeeAnnouncements,
  canSeeGlobalAnalytics,
  canSeeStorageQuotaWarnings,
  canUseAskAi,
  canUseRealtimePresence,
  defaultPlatformFeatureFlagSnapshot,
  defaultPlatformFeatureFlagState,
  isPersistedPlatformFeatureFlagKey,
  isRetiredPlatformFeatureFlagKey,
  authLoginAccountFooter,
  isSelfServeCompanySignupOpen,
  mergePlatformFeatureFlagSnapshot,
  mergePlatformFeatureFlagState,
  shouldForceClientUpdate,
} from "./platform-feature-flags.ts";

test("default platform flags are the eight catalog keys only — no Main Board", () => {
  assert.deepEqual(
    DEFAULT_PLATFORM_FEATURE_FLAGS.map((flag) => flag.key),
    [
      "platform.maintenance_mode",
      "platform.global_analytics",
      "platform.beta_ai",
      "platform.announcements",
      "platform.self_serve_company_signup",
      "platform.force_client_update",
      "platform.realtime",
      "platform.storage_quota_warnings",
    ],
  );
  assert.equal(
    DEFAULT_PLATFORM_FEATURE_FLAGS.some((flag) => flag.key === "platform.main_board"),
    false,
  );
});

test("platform.beta_billing is retired and not re-seeded", () => {
  assert.deepEqual([...RETIRED_PLATFORM_FEATURE_FLAG_KEYS], ["platform.beta_billing"]);
  assert.equal(isRetiredPlatformFeatureFlagKey("platform.beta_billing"), true);
  assert.equal(
    DEFAULT_PLATFORM_FEATURE_FLAGS.some((flag) => flag.key === "platform.beta_billing"),
    false,
  );
  assert.equal(isRetiredPlatformFeatureFlagKey("platform.beta_ai"), false);
});

test("catalog keys are the only persisted flags", () => {
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.maintenance_mode"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.announcements"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.self_serve_company_signup"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.force_client_update"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.realtime"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.storage_quota_warnings"), true);
  assert.equal(isPersistedPlatformFeatureFlagKey("custom.ad-hoc"), false);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.beta_billing"), false);
  assert.equal(isPersistedPlatformFeatureFlagKey("platform.main_board"), false);
});

test("defaults match the seed catalog", () => {
  const state = defaultPlatformFeatureFlagState();
  assert.equal(state["platform.maintenance_mode"], false);
  assert.equal(state["platform.global_analytics"], true);
  assert.equal(state["platform.beta_ai"], true);
  assert.equal(state["platform.announcements"], true);
  assert.equal(state["platform.self_serve_company_signup"], false);
  assert.equal(state["platform.force_client_update"], false);
  assert.equal(state["platform.realtime"], true);
  assert.equal(state["platform.storage_quota_warnings"], false);
  assert.equal(defaultPlatformFeatureFlagSnapshot().minClientVersion, "1.0.0");
});

test("mergePlatformFeatureFlagState overlays booleans and ignores junk", () => {
  const merged = mergePlatformFeatureFlagState({
    "platform.maintenance_mode": true,
    "platform.global_analytics": false,
    "platform.beta_ai": "yes",
    "platform.announcements": false,
    "platform.self_serve_company_signup": true,
    "platform.force_client_update": true,
    "platform.realtime": false,
    "platform.storage_quota_warnings": true,
    "custom.ad-hoc": true,
    "platform.main_board": false,
  });
  assert.equal(merged["platform.maintenance_mode"], true);
  assert.equal(merged["platform.global_analytics"], false);
  assert.equal(merged["platform.beta_ai"], true);
  assert.equal(merged["platform.announcements"], false);
  assert.equal(merged["platform.self_serve_company_signup"], true);
  assert.equal(merged["platform.force_client_update"], true);
  assert.equal(merged["platform.realtime"], false);
  assert.equal(merged["platform.storage_quota_warnings"], true);
  assert.equal("custom.ad-hoc" in merged, false);
  assert.equal("platform.main_board" in merged, false);
});

test("mergePlatformFeatureFlagSnapshot keeps a valid min client version", () => {
  const merged = mergePlatformFeatureFlagSnapshot({
    "platform.force_client_update": true,
    minClientVersion: "2.3.4",
  });
  assert.equal(merged["platform.force_client_update"], true);
  assert.equal(merged.minClientVersion, "2.3.4");
  assert.equal(mergePlatformFeatureFlagSnapshot({ min_client_version: "9.0.1" }).minClientVersion, "9.0.1");
  assert.equal(mergePlatformFeatureFlagSnapshot({ minClientVersion: "nope" }).minClientVersion, "1.0.0");
});

test("maintenance blocks non-owners only", () => {
  assert.equal(
    canAccessAppDuringMaintenance({ maintenanceMode: true, isPlatformOwner: false }),
    false,
  );
  assert.equal(
    canAccessAppDuringMaintenance({ maintenanceMode: true, isPlatformOwner: true }),
    true,
  );
  assert.equal(
    canAccessAppDuringMaintenance({ maintenanceMode: false, isPlatformOwner: false }),
    true,
  );
});

test("global analytics is a simple on/off gate", () => {
  assert.equal(canSeeGlobalAnalytics(true), true);
  assert.equal(canSeeGlobalAnalytics(false), false);
});

test("beta AI kill-switch does not widen grants and never blocks Platform Owner", () => {
  assert.equal(
    canUseAskAi({ betaAiEnabled: false, isPlatformOwner: false, grantAllowed: true }),
    false,
  );
  assert.equal(
    canUseAskAi({ betaAiEnabled: false, isPlatformOwner: true, grantAllowed: true }),
    true,
  );
  assert.equal(
    canUseAskAi({ betaAiEnabled: false, isPlatformOwner: true, grantAllowed: false }),
    false,
  );
  assert.equal(
    canUseAskAi({ betaAiEnabled: true, isPlatformOwner: false, grantAllowed: false }),
    false,
  );
  assert.equal(
    canUseAskAi({ betaAiEnabled: true, isPlatformOwner: false, grantAllowed: true }),
    true,
  );
});

test("announcements and realtime are simple kill-switches", () => {
  assert.equal(canSeeAnnouncements(true), true);
  assert.equal(canSeeAnnouncements(false), false);
  assert.equal(canUseRealtimePresence(true), true);
  assert.equal(canUseRealtimePresence(false), false);
});

test("self-serve company signup defaults locked", () => {
  assert.equal(isSelfServeCompanySignupOpen(false), false);
  assert.equal(isSelfServeCompanySignupOpen(true), true);
});

test("login footer hides no-account copy when self-serve is open", () => {
  assert.deepEqual(
    authLoginAccountFooter({ selfServeCompanySignup: true, gatesReady: true }),
    { showNoAccountMessage: false, showCompanySignupLink: true },
  );
  assert.deepEqual(
    authLoginAccountFooter({ selfServeCompanySignup: false, gatesReady: true }),
    { showNoAccountMessage: true, showCompanySignupLink: false },
  );
  assert.deepEqual(
    authLoginAccountFooter({ selfServeCompanySignup: undefined, gatesReady: true }),
    { showNoAccountMessage: true, showCompanySignupLink: false },
  );
  assert.deepEqual(
    authLoginAccountFooter({ selfServeCompanySignup: true, gatesReady: false }),
    { showNoAccountMessage: false, showCompanySignupLink: false },
  );
});

test("force client update never blocks Platform Owner", () => {
  assert.equal(
    shouldForceClientUpdate({
      forceClientUpdate: true,
      isPlatformOwner: true,
      currentIsOlderThanMin: true,
    }),
    false,
  );
  assert.equal(
    shouldForceClientUpdate({
      forceClientUpdate: true,
      isPlatformOwner: false,
      currentIsOlderThanMin: true,
    }),
    true,
  );
  assert.equal(
    shouldForceClientUpdate({
      forceClientUpdate: true,
      isPlatformOwner: false,
      currentIsOlderThanMin: false,
    }),
    false,
  );
  assert.equal(
    shouldForceClientUpdate({
      forceClientUpdate: false,
      isPlatformOwner: false,
      currentIsOlderThanMin: true,
    }),
    false,
  );
});

test("storage quota warnings are manager-facing only", () => {
  assert.equal(
    canSeeStorageQuotaWarnings({
      enabled: true,
      isBranchManager: true,
      isAssistantManager: false,
      canManageCompanySettings: false,
    }),
    true,
  );
  assert.equal(
    canSeeStorageQuotaWarnings({
      enabled: true,
      isBranchManager: false,
      isAssistantManager: true,
      canManageCompanySettings: true,
    }),
    true,
  );
  assert.equal(
    canSeeStorageQuotaWarnings({
      enabled: true,
      isBranchManager: false,
      isAssistantManager: true,
      canManageCompanySettings: false,
    }),
    false,
  );
  assert.equal(
    canSeeStorageQuotaWarnings({
      enabled: false,
      isBranchManager: true,
      isAssistantManager: false,
      canManageCompanySettings: true,
    }),
    false,
  );
});
