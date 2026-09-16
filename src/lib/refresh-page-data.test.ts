import assert from "node:assert/strict";
import { test } from "node:test";
import { QueryClient } from "@tanstack/react-query";
import { refreshKeyPolicy, refreshPageData } from "./refresh-page-data.ts";

test("refresh policy keeps session, chrome, and Ask AI keys", () => {
  assert.equal(refreshKeyPolicy(["auth", "me"]), "keep");
  assert.equal(refreshKeyPolicy(["route-guard", "roles", "u1"]), "keep");
  assert.equal(refreshKeyPolicy(["active-branch"]), "keep");
  assert.equal(refreshKeyPolicy(["my-ai-access", "u1"]), "keep");
  assert.equal(refreshKeyPolicy(["company-settings"]), "keep");
  assert.equal(refreshKeyPolicy(["customer-payment-visible"]), "keep");
});

test("refresh policy soft-refetches company/branch lists used by platform pages", () => {
  assert.equal(refreshKeyPolicy(["platform-companies", "p1"]), "soft-refetch");
  assert.equal(refreshKeyPolicy(["platform-branches", "c1"]), "soft-refetch");
  assert.equal(refreshKeyPolicy(["platform-branches", "__all__"]), "soft-refetch");
});

test("refresh policy drops page-specific keys including platform home stats", () => {
  assert.equal(refreshKeyPolicy(["platform-all-branches"]), "drop");
  assert.equal(refreshKeyPolicy(["platform-settings"]), "drop");
  assert.equal(refreshKeyPolicy(["platform", "owners"]), "drop");
  assert.equal(refreshKeyPolicy(["platform-feature-flags"]), "drop");
  assert.equal(refreshKeyPolicy(["employees", "c1"]), "drop");
});

test("refreshPageData drops page cache, keeps session and company list data", async () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  qc.setQueryData(["auth", "me"], { id: "u1" });
  qc.setQueryData(["my-ai-access", "u1"], { allowed: true });
  qc.setQueryData(["platform-companies", "p1"], [{ id: "c1" }]);
  qc.setQueryData(["platform-settings"], { supportEmail: "a@b.c" });
  qc.setQueryData(["platform-all-branches"], [{ id: "b1" }]);

  await refreshPageData(qc);

  assert.deepEqual(qc.getQueryData(["auth", "me"]), { id: "u1" });
  assert.deepEqual(qc.getQueryData(["my-ai-access", "u1"]), { allowed: true });
  assert.deepEqual(qc.getQueryData(["platform-companies", "p1"]), [{ id: "c1" }]);
  assert.equal(qc.getQueryData(["platform-settings"]), undefined);
  assert.equal(qc.getQueryData(["platform-all-branches"]), undefined);
  assert.equal(qc.getQueryState(["platform-companies", "p1"])?.isInvalidated, true);
});
