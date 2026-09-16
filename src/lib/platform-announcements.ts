export type AnnouncementScope = "all" | "company" | "branch";

export const PLATFORM_ANNOUNCEMENT_IMAGE_BUCKET = "platform-announcements";
export const PLATFORM_ANNOUNCEMENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const PLATFORM_ANNOUNCEMENT_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

const IMAGE_PATH_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp)$/i;

export function isPlatformAnnouncementImagePath(value: string): boolean {
  return IMAGE_PATH_RE.test(value);
}

export function announcementImageExt(mime: string): "jpg" | "png" | "webp" | null {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  return null;
}

export function resolveAnnouncementScope(data: {
  scope: AnnouncementScope;
  companyId?: string | null;
  branchId?: string | null;
}): { companyId: string | null; branchId: string | null } {
  if (data.scope === "company") {
    if (!data.companyId) throw new Error("Select a company.");
    return { companyId: data.companyId, branchId: null };
  }
  if (data.scope === "branch") {
    if (!data.companyId || !data.branchId) throw new Error("Select a company and branch.");
    return { companyId: data.companyId, branchId: data.branchId };
  }
  return { companyId: null, branchId: null };
}

export function scopeFromAnnouncementRow(row: {
  company_id: string | null;
  branch_id: string | null;
}): { scope: AnnouncementScope; companyId: string; branchId: string } {
  if (row.branch_id) {
    return { scope: "branch", companyId: row.company_id ?? "", branchId: row.branch_id };
  }
  if (row.company_id) {
    return { scope: "company", companyId: row.company_id, branchId: "" };
  }
  return { scope: "all", companyId: "", branchId: "" };
}

/** Viewer banner is redundant on the Platform Owner management page. */
export const PLATFORM_ANNOUNCEMENTS_ADMIN_PATH = "/platform/announcements";

export function isPlatformAnnouncementsAdminPath(pathname: string): boolean {
  const normalized = (pathname.split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
  return normalized === PLATFORM_ANNOUNCEMENTS_ADMIN_PATH;
}

/** Stack every undismissed row; order is preserved from the server list. */
export function undismissedAnnouncements<T extends { id: string }>(
  rows: readonly T[] | null | undefined,
  dismissedIds: readonly string[],
): T[] {
  if (!rows?.length) return [];
  const dismissed = new Set(dismissedIds);
  return rows.filter((row) => !dismissed.has(row.id));
}
