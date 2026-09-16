import assert from "node:assert/strict";
import { test } from "node:test";
import { compareClientVersions, isClientOlderThanMin, WEB_APP_VERSION } from "./client-version-compare.ts";

test("web / Windows client version is 1.0.0", () => {
  assert.equal(WEB_APP_VERSION, "1.0.0");
});

test("compareClientVersions orders semver triples", () => {
  assert.equal(compareClientVersions("1.0.0", "1.0.0"), 0);
  assert.ok(compareClientVersions("1.0.1", "1.0.0") > 0);
  assert.ok(compareClientVersions("1.0.0", "1.0.1") < 0);
  assert.ok(compareClientVersions("1.2.0", "1.10.0") < 0);
  assert.ok(compareClientVersions("2.0.0", "1.9.9") > 0);
});

test("isClientOlderThanMin is true only when current is behind min", () => {
  assert.equal(isClientOlderThanMin("1.0.0", "1.0.1"), true);
  assert.equal(isClientOlderThanMin("1.0.1", "1.0.1"), false);
  assert.equal(isClientOlderThanMin("1.1.0", "1.0.9"), false);
});
