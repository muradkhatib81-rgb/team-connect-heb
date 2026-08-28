/** Supabase Realtime Presence channel — all active sessions track here. */
export const ONLINE_PRESENCE_CHANNEL = "online-presence:v1";

/** RealtimeManager monitor row per user tracker. */
export const ONLINE_PRESENCE_MONITOR_PREFIX = "online-presence-";

/** Re-track at most this often while the user keeps interacting. */
export const ONLINE_PRESENCE_TRACK_THROTTLE_MS = 15_000;

/** Viewer treats presence as offline when last activity is older than this. */
export const ONLINE_PRESENCE_STALE_MS = 120_000;

/** Re-evaluate stale presence in the UI on this interval (no new Realtime event needed). */
export const ONLINE_PRESENCE_VIEWER_TICK_MS = 15_000;

/** Activity events that keep the user "online". (pointermove omitted — too noisy.) */
export const ONLINE_PRESENCE_ACTIVITY_EVENTS = [
  "pointerdown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
  "click",
] as const;

export type OnlinePresenceViewerScope = "platform" | "company" | "branch";

export type OnlinePresencePayload = {
  user_id: string;
  full_name: string;
  branch_id: string | null;
  company_id: string | null;
  branch_name: string | null;
  company_name: string | null;
  role: string;
  last_activity_at: string;
};

export type OnlinePresenceViewerAccess = {
  canView: boolean;
  viewerScope: OnlinePresenceViewerScope | null;
  branchId: string | null;
  companyId: string | null;
};

export type OnlinePresenceGrantRow = {
  user_id: string;
  viewer_scope: OnlinePresenceViewerScope;
  branch_id: string | null;
  company_id: string | null;
  enabled: boolean;
  granted_by: string | null;
  updated_at: string;
};

export function onlinePresenceMonitorName(uid: string): string {
  return `${ONLINE_PRESENCE_MONITOR_PREFIX}${uid}`;
}

export function parsePresencePayload(raw: unknown): OnlinePresencePayload | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const userId = typeof o.user_id === "string" ? o.user_id : null;
  if (!userId) return null;
  return {
    user_id: userId,
    full_name: typeof o.full_name === "string" ? o.full_name : "—",
    branch_id: typeof o.branch_id === "string" ? o.branch_id : null,
    company_id: typeof o.company_id === "string" ? o.company_id : null,
    branch_name: typeof o.branch_name === "string" ? o.branch_name : null,
    company_name: typeof o.company_name === "string" ? o.company_name : null,
    role: typeof o.role === "string" ? o.role : "",
    last_activity_at:
      typeof o.last_activity_at === "string" ? o.last_activity_at : new Date(0).toISOString(),
  };
}

export function isPresencePayloadFresh(
  payload: OnlinePresencePayload,
  now = Date.now(),
): boolean {
  const ts = Date.parse(payload.last_activity_at);
  if (Number.isNaN(ts)) return false;
  return now - ts <= ONLINE_PRESENCE_STALE_MS;
}

export function filterPresencesForViewer(
  presences: OnlinePresencePayload[],
  access: OnlinePresenceViewerAccess,
): OnlinePresencePayload[] {
  const fresh = presences.filter(isPresencePayloadFresh);
  if (!access.canView || !access.viewerScope) return [];
  if (access.viewerScope === "platform") return fresh;
  if (access.viewerScope === "company") {
    if (!access.companyId) return [];
    return fresh.filter((p) => p.company_id === access.companyId);
  }
  if (access.viewerScope === "branch") {
    if (!access.branchId) return [];
    return fresh.filter((p) => p.branch_id === access.branchId);
  }
  return [];
}

/** Dedupe by user_id — keep freshest last_activity_at. */
export function dedupePresenceUsers(list: OnlinePresencePayload[]): OnlinePresencePayload[] {
  const byUser = new Map<string, OnlinePresencePayload>();
  for (const p of list) {
    const prev = byUser.get(p.user_id);
    if (!prev || Date.parse(p.last_activity_at) > Date.parse(prev.last_activity_at)) {
      byUser.set(p.user_id, p);
    }
  }
  return [...byUser.values()].sort((a, b) => a.full_name.localeCompare(b.full_name, "he"));
}

export type PresenceLocationLabels = {
  branchNames: Map<string, string>;
  companyByBranch: Map<string, { companyId: string; companyName: string }>;
};

export type PresenceCompanyGroup = {
  companyId: string | null;
  companyName: string;
  branches: PresenceBranchGroup[];
  userCount: number;
};

export type PresenceBranchGroup = {
  branchId: string | null;
  branchName: string;
  users: OnlinePresencePayload[];
};

const UNASSIGNED_KEY = "__unassigned__";

/** Group online users by company, then branch (platform owner view). */
export function groupPresenceByLocation(
  users: OnlinePresencePayload[],
  labels?: PresenceLocationLabels,
): PresenceCompanyGroup[] {
  const branchNames = labels?.branchNames ?? new Map<string, string>();
  const companyByBranch = labels?.companyByBranch ?? new Map();

  type BranchBucket = { branchId: string | null; branchName: string; users: OnlinePresencePayload[] };
  type CompanyBucket = {
    companyId: string | null;
    companyName: string;
    branches: Map<string, BranchBucket>;
  };

  const companies = new Map<string, CompanyBucket>();

  const ensureCompany = (companyId: string | null, companyName: string) => {
    const key = companyId ?? UNASSIGNED_KEY;
    let bucket = companies.get(key);
    if (!bucket) {
      bucket = { companyId, companyName, branches: new Map() };
      companies.set(key, bucket);
    }
    return bucket;
  };

  const ensureBranch = (company: CompanyBucket, branchId: string | null, branchName: string) => {
    const key = branchId ?? UNASSIGNED_KEY;
    let bucket = company.branches.get(key);
    if (!bucket) {
      bucket = { branchId, branchName, users: [] };
      company.branches.set(key, bucket);
    }
    return bucket;
  };

  for (const user of users) {
    const branchId = user.branch_id;
    const branchName =
      user.branch_name ??
      (branchId ? branchNames.get(branchId) : null) ??
      null;
    const assignment = branchId ? companyByBranch.get(branchId) : undefined;
    const companyId = user.company_id ?? assignment?.companyId ?? null;
    const companyName = user.company_name ?? assignment?.companyName ?? null;

    const company = ensureCompany(companyId, companyName ?? "");
    const branch = ensureBranch(company, branchId, branchName ?? "");
    branch.users.push(user);
  }

  const result: PresenceCompanyGroup[] = [...companies.values()].map((company) => {
    const branches = [...company.branches.values()]
      .map((branch) => ({
        ...branch,
        users: [...branch.users].sort((a, b) => a.full_name.localeCompare(b.full_name, "he")),
      }))
      .sort((a, b) => a.branchName.localeCompare(b.branchName, "he"));
    const userCount = branches.reduce((sum, b) => sum + b.users.length, 0);
    return { ...company, branches, userCount };
  });

  return result.sort((a, b) => {
    if (!a.companyName && b.companyName) return 1;
    if (a.companyName && !b.companyName) return -1;
    return a.companyName.localeCompare(b.companyName, "he");
  });
}
