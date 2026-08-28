import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { getRealtimeManager } from "@/core/bootstrap";

const BRIDGE_PREFIX = "global-realtime-";

export function isBridgeChannelName(name: string): boolean {
  return name.startsWith(BRIDGE_PREFIX);
}

export function bridgeChannelName(uid: string, activeBranchId: string | null | undefined): string {
  return `${BRIDGE_PREFIX}${uid}-${activeBranchId ?? "all"}`;
}

function wrapBridgeChannel(channel: RealtimeChannel, channelName: string): RealtimeChannel {
  const proxy = new Proxy(channel, {
    get(target, prop) {
      if (prop === "on") {
        return (event: string, filter: unknown, handler: unknown) => {
          if (event === "postgres_changes" && typeof handler === "function") {
            target.on(event, filter as never, (payload: unknown) => {
              recordBridgeChannelActivity(channelName);
              (handler as (payload: unknown) => void)(payload);
            });
          } else {
            target.on(event as never, filter as never, handler as never);
          }
          return proxy;
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  return proxy as RealtimeChannel;
}

/** Supabase channel + proxy that records postgres_changes activity in RealtimeManager. */
export function createBridgeChannel(channelName: string): {
  raw: RealtimeChannel;
  channel: RealtimeChannel;
} {
  const raw = supabase.channel(channelName);
  return { raw, channel: wrapBridgeChannel(raw, channelName) };
}

export function syncBridgeChannelOpen(input: {
  name: string;
  userId: string;
  branchId: string | null;
}): void {
  const mgr = getRealtimeManager();
  const branchLabel = input.branchId ?? "all";
  const description = `Supabase RealtimeBridge — postgres_changes for branch ${branchLabel}`;
  try {
    mgr.openChannel({ name: input.name, description, visibility: "system" });
  } catch {
    mgr.updateChannel(input.name, { description, visibility: "system" });
  }
}

export function syncBridgeChannelClose(name: string): void {
  const mgr = getRealtimeManager();
  if (!mgr.getSnapshot(name)) return;
  try {
    mgr.closeChannel(name);
  } catch {
    /* channel may already be closed */
  }
}

export function recordBridgeChannelActivity(name: string): void {
  getRealtimeManager().recordActivity(name);
}
