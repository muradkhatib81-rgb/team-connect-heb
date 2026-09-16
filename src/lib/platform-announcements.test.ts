import assert from "node:assert/strict";
import { test } from "node:test";
import {
  announcementImageExt,
  isPlatformAnnouncementImagePath,
  isPlatformAnnouncementsAdminPath,
  resolveAnnouncementScope,
  scopeFromAnnouncementRow,
  undismissedAnnouncements,
} from "./platform-announcements.ts";

test("resolveAnnouncementScope maps all / company / branch", () => {
  assert.deepEqual(resolveAnnouncementScope({ scope: "all", companyId: "x", branchId: "y" }), {
    companyId: null,
    branchId: null,
  });
  assert.deepEqual(
    resolveAnnouncementScope({
      scope: "company",
      companyId: "11111111-1111-1111-1111-111111111111",
    }),
    { companyId: "11111111-1111-1111-1111-111111111111", branchId: null },
  );
  assert.deepEqual(
    resolveAnnouncementScope({
      scope: "branch",
      companyId: "11111111-1111-1111-1111-111111111111",
      branchId: "22222222-2222-2222-2222-222222222222",
    }),
    {
      companyId: "11111111-1111-1111-1111-111111111111",
      branchId: "22222222-2222-2222-2222-222222222222",
    },
  );
});

test("resolveAnnouncementScope requires company and branch when scoped", () => {
  assert.throws(() => resolveAnnouncementScope({ scope: "company" }), /Select a company/);
  assert.throws(
    () =>
      resolveAnnouncementScope({
        scope: "branch",
        companyId: "11111111-1111-1111-1111-111111111111",
      }),
    /company and branch/,
  );
});

test("scopeFromAnnouncementRow round-trips targeting", () => {
  assert.deepEqual(scopeFromAnnouncementRow({ company_id: null, branch_id: null }), {
    scope: "all",
    companyId: "",
    branchId: "",
  });
  assert.equal(scopeFromAnnouncementRow({ company_id: "c1", branch_id: null }).scope, "company");
  assert.equal(scopeFromAnnouncementRow({ company_id: "c1", branch_id: "b1" }).scope, "branch");
});

test("announcement image helpers accept jpeg/png/webp uuid paths", () => {
  assert.equal(announcementImageExt("image/jpeg"), "jpg");
  assert.equal(announcementImageExt("image/gif"), null);
  assert.equal(isPlatformAnnouncementImagePath("11111111-1111-4111-8111-111111111111.jpg"), true);
  assert.equal(isPlatformAnnouncementImagePath("../secret.png"), false);
  assert.equal(isPlatformAnnouncementImagePath("avatars/x.jpg"), false);
});

test("isPlatformAnnouncementsAdminPath matches only the owner management route", () => {
  assert.equal(isPlatformAnnouncementsAdminPath("/platform/announcements"), true);
  assert.equal(isPlatformAnnouncementsAdminPath("/platform/announcements/"), true);
  assert.equal(isPlatformAnnouncementsAdminPath("/platform/announcements?tab=new"), true);
  assert.equal(isPlatformAnnouncementsAdminPath("/dashboard"), false);
  assert.equal(isPlatformAnnouncementsAdminPath("/platform"), false);
  assert.equal(isPlatformAnnouncementsAdminPath("/platform/announcements/extra"), false);
});

test("undismissedAnnouncements stacks remaining rows in server order", () => {
  const rows = [
    { id: "a", title: "newest" },
    { id: "b", title: "older" },
    { id: "c", title: "oldest" },
  ];
  assert.deepEqual(
    undismissedAnnouncements(rows, []).map((row) => row.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    undismissedAnnouncements(rows, ["a"]).map((row) => row.title),
    ["older", "oldest"],
  );
  assert.deepEqual(undismissedAnnouncements(rows, ["a", "b", "c"]), []);
  assert.deepEqual(undismissedAnnouncements(undefined, ["a"]), []);
});
