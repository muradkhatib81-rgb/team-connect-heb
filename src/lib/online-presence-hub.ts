import {
  ONLINE_PRESENCE_ACTIVITY_EVENTS,
  ONLINE_PRESENCE_CHANNEL,
  ONLINE_PRESENCE_STALE_MS,
  ONLINE_PRESENCE_TRACK_THROTTLE_MS,
  type OnlinePresencePayload,
  onlinePresenceMonitorName,
  parsePresencePayload,
} from "@/lib/online-presence";
import { recordBridgeChannelActivity } from "@/lib/realtime-bridge-sync";
import { getRealtimeManager } from "@/core/bootstrap";
import { supabase } from "@/integrations/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

export type OnlinePresenceTrackInput = {
  userId: string;
  fullName: string;
  branchId: string | null;
  companyId: string | null;
  branchName: string | null;
  companyName: string | null;
  role: string;
};

type HubState = {
  channel: RealtimeChannel | null;
  trackInput: OnlinePresenceTrackInput | null;
  trackRefCount: number;
  viewRefCount: number;
  lastTrackAt: number;
  subscribed: boolean;
  disposed: boolean;
  activityBound: boolean;
  idleUntrackTimer: ReturnType<typeof setTimeout> | null;
  isTracked: boolean;
  visibilityBound: boolean;
};

const hub: HubState = {
  channel: null,
  trackInput: null,
  trackRefCount: 0,
  viewRefCount: 0,
  lastTrackAt: 0,
  subscribed: false,
  disposed: false,
  activityBound: false,
  idleUntrackTimer: null,
  isTracked: false,
  visibilityBound: false,
};

const snapshotListeners = new Set<() => void>();

function collectPresenceState(channel: RealtimeChannel): OnlinePresencePayload[] {
  const state = channel.presenceState() as Record<string, unknown[]>;
  const out: OnlinePresencePayload[] = [];
  for (const entries of Object.values(state)) {
    for (const entry of entries) {
      const parsed = parsePresencePayload(entry);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

let cachedSnapshot: OnlinePresencePayload[] = [];

export function getOnlinePresenceSnapshot(): OnlinePresencePayload[] {
  return cachedSnapshot;
}

export function subscribeOnlinePresenceSnapshot(listener: () => void): () => void {
  snapshotListeners.add(listener);
  return () => snapshotListeners.delete(listener);
}

function emitSnapshot(): void {
  if (hub.channel) {
    cachedSnapshot = collectPresenceState(hub.channel);
  }
  snapshotListeners.forEach((fn) => fn());
}

function openPresenceMonitor(uid: string, branchLabel: string): void {
  const monitorName = onlinePresenceMonitorName(uid);
  const mgr = getRealtimeManager();
  const description = `Online presence · branch ${branchLabel}`;
  try {
    mgr.openChannel({ name: monitorName, description, visibility: "system" });
  } catch {
    mgr.updateChannel(monitorName, { description, visibility: "system" });
  }
  mgr.setBridgeSupabaseStatus(monitorName, "connecting");
}

function closePresenceMonitor(uid: string): void {
  const monitorName = onlinePresenceMonitorName(uid);
  const mgr = getRealtimeManager();
  if (!mgr.getSnapshot(monitorName)) return;
  mgr.setBridgeSupabaseStatus(monitorName, "closed");
  try {
    mgr.closeChannel(monitorName);
  } catch {
    /* already closed */
  }
}

function buildPayload(input: OnlinePresenceTrackInput): OnlinePresencePayload {
  return {
    user_id: input.userId,
    full_name: input.fullName,
    branch_id: input.branchId,
    company_id: input.companyId,
    branch_name: input.branchName,
    company_name: input.companyName,
    role: input.role,
    last_activity_at: new Date().toISOString(),
  };
}

async function trackNow(force = false): Promise<void> {
  if (!hub.channel || !hub.trackInput || !hub.subscribed || hub.disposed) return;
  const now = Date.now();
  if (!force && now - hub.lastTrackAt < ONLINE_PRESENCE_TRACK_THROTTLE_MS) return;
  hub.lastTrackAt = now;
  const monitorName = onlinePresenceMonitorName(hub.trackInput.userId);
  try {
    await hub.channel.track(buildPayload(hub.trackInput));
    hub.isTracked = true;
    recordBridgeChannelActivity(monitorName);
    getRealtimeManager().setBridgeSupabaseStatus(monitorName, "SUBSCRIBED");
    scheduleIdleUntrack();
  } catch {
    /* reconnecting */
  }
}

function clearIdleUntrackTimer(): void {
  if (hub.idleUntrackTimer) {
    clearTimeout(hub.idleUntrackTimer);
    hub.idleUntrackTimer = null;
  }
}

async function untrackDueToIdle(): Promise<void> {
  if (!hub.channel || !hub.subscribed || !hub.isTracked || hub.disposed) return;
  try {
    await hub.channel.untrack();
    hub.isTracked = false;
    emitSnapshot();
  } catch {
    /* channel reconnecting */
  }
}

function scheduleIdleUntrack(): void {
  if (!hub.trackInput || hub.trackRefCount === 0) return;
  clearIdleUntrackTimer();
  hub.idleUntrackTimer = setTimeout(() => {
    hub.idleUntrackTimer = null;
    void untrackDueToIdle();
  }, ONLINE_PRESENCE_STALE_MS);
}

function onActivity(): void {
  if (!hub.isTracked) {
    void trackNow(true);
    return;
  }
  void trackNow(false);
}

function onVisibilityChange(): void {
  if (typeof document === "undefined") return;
  if (document.visibilityState === "hidden") {
    clearIdleUntrackTimer();
    hub.idleUntrackTimer = setTimeout(() => {
      hub.idleUntrackTimer = null;
      void untrackDueToIdle();
    }, ONLINE_PRESENCE_STALE_MS);
    return;
  }
  if (hub.trackInput && hub.trackRefCount > 0) {
    void trackNow(true);
  }
}

function bindActivityListeners(): void {
  if (hub.activityBound || typeof window === "undefined") return;
  hub.activityBound = true;
  for (const ev of ONLINE_PRESENCE_ACTIVITY_EVENTS) {
    window.addEventListener(ev, onActivity, { passive: true });
  }
}

function bindVisibilityListener(): void {
  if (hub.visibilityBound || typeof document === "undefined") return;
  hub.visibilityBound = true;
  document.addEventListener("visibilitychange", onVisibilityChange);
}

function unbindActivityListeners(): void {
  if (!hub.activityBound || typeof window === "undefined") return;
  hub.activityBound = false;
  for (const ev of ONLINE_PRESENCE_ACTIVITY_EVENTS) {
    window.removeEventListener(ev, onActivity);
  }
}

function unbindVisibilityListener(): void {
  if (!hub.visibilityBound || typeof document === "undefined") return;
  hub.visibilityBound = false;
  document.removeEventListener("visibilitychange", onVisibilityChange);
}

function ensureChannel(): RealtimeChannel {
  if (hub.channel) return hub.channel;
  const presenceKey = hub.trackInput?.userId ?? `viewer-${Math.random().toString(36).slice(2)}`;
  const channel = supabase.channel(ONLINE_PRESENCE_CHANNEL, {
    config: { presence: { key: presenceKey } },
  });
  channel
    .on("presence", { event: "sync" }, () => {
      emitSnapshot();
      if (hub.trackInput) {
        recordBridgeChannelActivity(onlinePresenceMonitorName(hub.trackInput.userId));
      }
    })
    .on("presence", { event: "join" }, emitSnapshot)
    .on("presence", { event: "leave" }, emitSnapshot);

  void channel.subscribe(async (status) => {
    if (hub.disposed) return;
    if (status === "SUBSCRIBED") {
      hub.subscribed = true;
      if (hub.trackInput) {
        getRealtimeManager().setBridgeSupabaseStatus(
          onlinePresenceMonitorName(hub.trackInput.userId),
          status,
        );
        await trackNow(true);
      }
      emitSnapshot();
    } else if (hub.trackInput) {
      getRealtimeManager().setBridgeSupabaseStatus(
        onlinePresenceMonitorName(hub.trackInput.userId),
        status,
      );
    }
  });

  hub.channel = channel;
  return channel;
}

function teardownChannelIfIdle(): void {
  if (hub.trackRefCount > 0 || hub.viewRefCount > 0) return;
  hub.disposed = true;
  hub.subscribed = false;
  hub.isTracked = false;
  clearIdleUntrackTimer();
  unbindActivityListeners();
  unbindVisibilityListener();
  if (hub.channel) {
    void hub.channel.untrack();
    void supabase.removeChannel(hub.channel);
    hub.channel = null;
  }
  const uid = hub.trackInput?.userId;
  hub.trackInput = null;
  cachedSnapshot = [];
  emitSnapshot();
  if (uid) closePresenceMonitor(uid);
}

/** Update tracked metadata (branch/company/name) without leaving the channel. */
export function updateOnlinePresenceTrackInput(input: OnlinePresenceTrackInput): void {
  if (!hub.trackInput || hub.trackInput.userId !== input.userId) return;
  hub.trackInput = input;
  if (hub.isTracked && hub.subscribed) void trackNow(true);
}

/** Start publishing presence for the signed-in user (AppShell). */
export function startOnlinePresenceTracking(input: OnlinePresenceTrackInput): () => void {
  if (typeof window === "undefined") return () => {};

  hub.trackInput = input;
  hub.disposed = false;
  hub.trackRefCount += 1;
  openPresenceMonitor(input.userId, input.branchId ?? "none");
  ensureChannel();
  bindActivityListeners();
  bindVisibilityListener();
  void trackNow(true);

  return () => {
    hub.trackRefCount = Math.max(0, hub.trackRefCount - 1);
    if (hub.trackRefCount === 0) {
      clearIdleUntrackTimer();
      const uid = hub.trackInput?.userId;
      if (hub.channel && hub.subscribed && hub.isTracked) void hub.channel.untrack();
      hub.isTracked = false;
      if (uid) closePresenceMonitor(uid);
      hub.trackInput = null;
      unbindActivityListeners();
      unbindVisibilityListener();
    }
    teardownChannelIfIdle();
  };
}

/** Subscribe to live presence snapshots (viewers + trackers share one channel). */
export function acquireOnlinePresenceViewer(): () => void {
  if (typeof window === "undefined") return () => {};

  hub.viewRefCount += 1;
  hub.disposed = false;
  ensureChannel();
  emitSnapshot();

  return () => {
    hub.viewRefCount = Math.max(0, hub.viewRefCount - 1);
    teardownChannelIfIdle();
  };
}
