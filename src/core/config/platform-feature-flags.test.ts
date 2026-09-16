import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_PLATFORM_FEATURE_FLAGS,
  RETIRED_PLATFORM_FEATURE_FLAG_KEYS,
  isRetiredPlatformFeatureFlagKey,
} from "./platform-feature-flags.ts";

test("default platform flags keep maintenance, analytics, and beta AI", () => {
  assert.deepEqual(
    DEFAULT_PLATFORM_FEATURE_FLAGS.map((flag) => flag.key),
    ["platform.maintenance_mode", "platform.global_analytics", "platform.beta_ai"],
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
