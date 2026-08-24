/**
 * Platform Owner read API for health snapshots/events.
 * Auth: existing platform-owner check only — no role/permission changes.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  runPlatformHealthScan,
  type PlatformHealthEvent,
  type PlatformHealthScanResult,
  type PlatformHealthSnapshot,
} from "@/lib/platform-health.server";

async function assertPlatformOwner(supabase: any, userId: string): Promise<void> {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("אין הרשאה");
}

export const getPlatformHealthDashboard = createServerFn({ method: "GET" }).handler(
  async (): Promise<{
    snapshots: PlatformHealthSnapshot[];
    events: PlatformHealthEvent[];
  }> => {
    const { supabase, userId } = await requireSupabaseAuth();
    await assertPlatformOwner(supabase, userId);
    // Prefer caller's RLS-backed reads; fall back to admin if tables missing mid-migrate.
    const snapRes = await (supabase as any)
      .from("platform_health_snapshots")
      .select(
        "id,target_key,target_kind,target_id,target_name,state,severity,message,details,latency_ms,checked_at,updated_at",
      )
      .order("target_kind", { ascending: true })
      .order("target_name", { ascending: true });

    if (snapRes.error) {
      // Table may not exist yet before migration — return empty rather than crash.
      if (/does not exist|relation/i.test(snapRes.error.message)) {
        return { snapshots: [], events: [] };
      }
      throw new Error(snapRes.error.message);
    }

    const eventRes = await (supabase as any)
      .from("platform_health_events")
      .select(
        "id,target_kind,target_id,target_name,state,severity,event_type,message,details,latency_ms,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (eventRes.error) {
      if (/does not exist|relation/i.test(eventRes.error.message)) {
        return { snapshots: (snapRes.data ?? []) as PlatformHealthSnapshot[], events: [] };
      }
      throw new Error(eventRes.error.message);
    }

    return {
      snapshots: (snapRes.data ?? []) as PlatformHealthSnapshot[],
      events: (eventRes.data ?? []) as PlatformHealthEvent[],
    };
  },
);

/** Optional manual trigger for Platform Owner — still runs on the server. */
export const triggerPlatformHealthScan = createServerFn({ method: "POST" }).handler(
  async (): Promise<PlatformHealthScanResult> => {
    const { supabase, userId } = await requireSupabaseAuth();
    await assertPlatformOwner(supabase, userId);
    return runPlatformHealthScan();
  },
);

export type { PlatformHealthEvent, PlatformHealthSnapshot, PlatformHealthScanResult };
