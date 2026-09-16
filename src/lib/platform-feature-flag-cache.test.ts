import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLATFORM_CLIENT_GATES_QUERY_KEY,
  PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY,
  defaultPlatformFeatureFlagSnapshot,
} from "../core/config/platform-feature-flags.ts";
import {
  applyPlatformFeatureFlagSyncRow,
  invalidatePlatformAnnouncementQueries,
  type FlagQueryCache,
} from "./platform-feature-flag-cache.ts";

function createMemoryCache(): FlagQueryCache & {
  data: Map<string, unknown>;
  invalidated: string[];
} {
  const data = new Map<string, unknown>();
  const invalidated: string[] = [];
  return {
    data,
    invalidated,
    getQueryData: (queryKey) => data.get(JSON.stringify(queryKey)),
    setQueryData: (queryKey, value) => {
      data.set(JSON.stringify(queryKey), value);
      return value;
    },
    invalidateQueries: ({ queryKey }) => {
      invalidated.push(JSON.stringify(queryKey));
    },
  };
}

test("applyPlatformFeatureFlagSyncRow writes flag state and client gates immediately", () => {
  const qc = createMemoryCache();
  qc.setQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY, defaultPlatformFeatureFlagSnapshot());

  applyPlatformFeatureFlagSyncRow(qc, {
    ff_maintenance_mode: true,
    ff_force_client_update: true,
    min_client_version: "1.2.3",
  });

  const state = qc.getQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY) as {
    "platform.maintenance_mode": boolean;
    "platform.force_client_update": boolean;
    minClientVersion: string;
  };
  assert.equal(state["platform.maintenance_mode"], true);
  assert.equal(state["platform.force_client_update"], true);
  assert.equal(state.minClientVersion, "1.2.3");

  const gates = qc.getQueryData(PLATFORM_CLIENT_GATES_QUERY_KEY) as {
    maintenanceMode: boolean;
    forceClientUpdate: boolean;
    minClientVersion: string;
  };
  assert.equal(gates.maintenanceMode, true);
  assert.equal(gates.forceClientUpdate, true);
  assert.equal(gates.minClientVersion, "1.2.3");
  assert.ok(qc.invalidated.includes(JSON.stringify(["my-ai-access"])));
  assert.ok(qc.invalidated.includes(JSON.stringify(["platform-announcements-visible"])));
});

test("applyPlatformFeatureFlagSyncRow does not reset unspecified flags", () => {
  const qc = createMemoryCache();
  qc.setQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY, {
    ...defaultPlatformFeatureFlagSnapshot(),
    "platform.beta_ai": false,
    "platform.announcements": false,
  });

  applyPlatformFeatureFlagSyncRow(qc, { ff_maintenance_mode: true });

  const state = qc.getQueryData(PLATFORM_FEATURE_FLAG_STATE_QUERY_KEY) as {
    "platform.maintenance_mode": boolean;
    "platform.beta_ai": boolean;
    "platform.announcements": boolean;
  };
  assert.equal(state["platform.maintenance_mode"], true);
  assert.equal(state["platform.beta_ai"], false);
  assert.equal(state["platform.announcements"], false);
});

test("invalidatePlatformAnnouncementQueries marks banner and admin lists stale", () => {
  const qc = createMemoryCache();
  invalidatePlatformAnnouncementQueries(qc);
  assert.deepEqual(qc.invalidated, [
    JSON.stringify(["platform-announcements-visible"]),
    JSON.stringify(["platform-announcements-admin"]),
  ]);
});
