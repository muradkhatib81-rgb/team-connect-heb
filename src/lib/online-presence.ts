/** Supabase Realtime Presence channel — all active sessions track here. */
export const ONLINE_PRESENCE_CHANNEL = "online-presence:v1";

/** RealtimeManager monitor row per user tracker. */
export const ONLINE_PRESENCE_MONITOR_PREFIX = "online-presence-";

/** Re-track at most this often while the user keeps interacting. */
export const ONLINE_PRESENCE_TRACK_THROTTLE_MS = 15_000;

/** Viewer treats presence as offline when last activity is older than this. */
export const ONLINE_PRESENCE_STALE_MS = 120_000;

/** Activity events that keep the user "online". */
export const ONLINE_PRESENCE_ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
] as const;

export type OnlinePresenceViewerScope = "platform" | "company" | "branch";

export type OnlinePresencePayload = {
  user_id: string;
  full_name: string;
  branch_id: string | null;
  company_id: string | null;
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
