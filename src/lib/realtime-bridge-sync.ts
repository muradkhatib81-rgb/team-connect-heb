import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getRealtimeManager } from "@/core/bootstrap";

const BRIDGE_PREFIX = "global-realtime-";

export type BridgePostgresConfig = {
  event?: string;
  schema: string;
  table: string;
  filter?: string;
};

export function isBridgeChannelName(name: string): boolean {
  return name.startsWith(BRIDGE_PREFIX);
}

/** Stable RealtimeManager key — one row per user for the platform monitor page. */
export function bridgeMonitorName(uid: string): string {
  return `${BRIDGE_PREFIX}${uid}`;
}

/** Supabase WebSocket channel — changes when the active branch changes. */
export function bridgeSupabaseChannelName(
  uid: string,
  activeBranchId: string | null | undefined,
): string {
  return `${BRIDGE_PREFIX}${uid}-${activeBranchId ?? "all"}`;
}

/** @deprecated use bridgeSupabaseChannelName */
export function bridgeChannelName(uid: string, activeBranchId: string | null | undefined): string {
  return bridgeSupabaseChannelName(uid, activeBranchId);
}

/** Register postgres_changes and mirror each event into the stable monitor channel. */
export function bridgePostgresOn(
  channel: RealtimeChannel,
  monitorName: string,
  config: BridgePostgresConfig,
  handler: (payload: unknown) => void,
): RealtimeChannel {
  return channel.on("postgres_changes", config as never, (payload: unknown) => {
    recordBridgeChannelActivity(monitorName);
    handler(payload);
  });
}

export function createBridgeChannel(channelName: string): {
  raw: RealtimeChannel;
  channel: RealtimeChannel;
} {
  const raw = supabase.channel(channelName);
  return { raw, channel: raw };
}

export function syncBridgeMonitorOpen(input: {
  monitorName: string;
  userId: string;
  branchId: string | null;
  supabaseChannel: string;
}): void {
  pruneLegacyBridgeChannels(input.userId);
  const mgr = getRealtimeManager();
  const branchLabel = input.branchId ?? "all";
  const description = `Supabase RealtimeBridge — branch ${branchLabel} · ws ${input.supabaseChannel}`;
  try {
    mgr.openChannel({ name: input.monitorName, description, visibility: "system" });
  } catch {
    mgr.updateChannel(input.monitorName, { description, visibility: "system" });
  }
}

export function syncBridgeMonitorClose(monitorName: string): void {
  const mgr = getRealtimeManager();
  if (!mgr.getSnapshot(monitorName)) return;
  mgr.setBridgeSupabaseStatus(monitorName, "closed");
  try {
    mgr.closeChannel(monitorName);
  } catch {
    /* already closed */
  }
}

export function syncBridgeSupabaseStatus(monitorName: string, status: string): void {
  const mgr = getRealtimeManager();
  if (!mgr.getSnapshot(monitorName)) {
    try {
      mgr.openChannel({ name: monitorName, description: "Supabase RealtimeBridge", visibility: "system" });
    } catch {
      /* reopen below */
    }
  }
  mgr.setBridgeSupabaseStatus(monitorName, status);
}

export function recordBridgeChannelActivity(monitorName: string): void {
  const mgr = getRealtimeManager();
  let snap = mgr.getSnapshot(monitorName);
  if (!snap || snap.closedAt) {
    try {
      mgr.openChannel({
        name: monitorName,
        description: "Supabase RealtimeBridge",
        visibility: "system",
      });
    } catch {
      mgr.updateChannel(monitorName, { visibility: "system" });
    }
  }
  mgr.recordActivity(monitorName);
}

/** Fallback when postgres_changes are filtered — e.g. after a successful schedule publish. */
export function notifyBridgeOperationalActivity(uid: string, eventCount = 1): void {
  const count = Math.max(1, Math.min(eventCount, 500));
  for (let i = 0; i < count; i++) {
    recordBridgeChannelActivity(bridgeMonitorName(uid));
  }
}

/** Notify RealtimeBridge in this tab (and record monitor stats). */
export function pulseBridgeActivity(uid: string, eventCount = 1): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("tc-bridge-activity", { detail: { uid, count: eventCount } }),
  );
}

/** Drop old per-branch bridge rows (Phase 3) so the monitor page shows one stable channel. */
export function pruneLegacyBridgeChannels(uid: string): void {
  const mgr = getRealtimeManager();
  const stable = bridgeMonitorName(uid);
  for (const name of mgr.listChannelNames()) {
    if (isBridgeChannelName(name) && name !== stable) {
      try {
        mgr.deleteChannel(name);
      } catch {
        /* already gone */
      }
    }
  }
}
