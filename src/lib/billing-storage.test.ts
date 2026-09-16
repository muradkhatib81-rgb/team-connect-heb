import assert from "node:assert/strict";
import { test } from "node:test";
import { isStorageNearQuota } from "./billing-storage.ts";

test("storage near-quota warning uses 80% of a finite grant", () => {
  const quotaMb = 1000;
  const eighty = 1000 * 1024 * 1024 * 0.8;
  assert.equal(isStorageNearQuota(eighty, quotaMb), true);
  assert.equal(isStorageNearQuota(eighty - 1, quotaMb), false);
  assert.equal(isStorageNearQuota(eighty, null), false);
  assert.equal(isStorageNearQuota(eighty, 0), false);
});
