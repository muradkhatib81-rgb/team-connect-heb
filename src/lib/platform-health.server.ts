/**
 * Platform health monitoring — server-only scan + read helpers.
 * Does not touch roles/permissions. Scan writes only to health tables.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const PLATFORM_HEALTH_INTERVAL_MS = 20 * 60 * 1000;

export type HealthState = "healthy" | "degraded" | "down" | "unknown";
export type HealthSeverity = "info" | "warning" | "error" | "critical";
export type HealthTargetKind = "platform" | "company" | "branch" | "database" | "api";
export type HealthEventType = "issue" | "recovery" | "overload";

export type PlatformHealthSnapshot = {
  id: string;
  target_key: string;
  target_kind: HealthTargetKind;
  target_id: string | null;
  target_name: string;
  state: HealthState;
  severity: HealthSeverity;
  message: string | null;
  details: Record<string, unknown>;
  latency_ms: number | null;
  checked_at: string;
  updated_at: string;
};

export type PlatformHealthEvent = {
  id: string;
  target_kind: HealthTargetKind;
  target_id: string | null;
  target_name: string;
  state: HealthState;
  severity: HealthSeverity;
  event_type: HealthEventType;
  message: string;
  details: Record<string, unknown>;
  latency_ms: number | null;
  created_at: string;
};

export type PlatformHealthScanResult = {
  ok: boolean;
  companies_checked?: number;
  branches_checked?: number;
  issues?: number;
  duration_ms?: number;
  checked_at?: string;
  error?: string;
};

let scanInFlight: Promise<PlatformHealthScanResult> | null = null;
let schedulerStarted = false;

export async function runPlatformHealthScan(): Promise<PlatformHealthScanResult> {
  if (scanInFlight) return scanInFlight;

  scanInFlight = (async () => {
    try {
      const { data, error } = await (supabaseAdmin as any).rpc("run_platform_health_scan");
      if (error) {
        console.warn("[platform-health] scan failed:", error.message);
        return { ok: false, error: error.message };
      }
      const row = (data ?? {}) as PlatformHealthScanResult;
      return {
        ok: row.ok !== false,
        companies_checked: Number(row.companies_checked ?? 0),
        branches_checked: Number(row.branches_checked ?? 0),
        issues: Number(row.issues ?? 0),
        duration_ms: Number(row.duration_ms ?? 0),
        checked_at: typeof row.checked_at === "string" ? row.checked_at : undefined,
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : "scan failed";
      console.warn("[platform-health] scan exception:", message);
      return { ok: false, error: message };
    } finally {
      scanInFlight = null;
    }
  })();

  return scanInFlight;
}

export async function listPlatformHealthSnapshots(): Promise<PlatformHealthSnapshot[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_health_snapshots")
    .select(
      "id,target_key,target_kind,target_id,target_name,state,severity,message,details,latency_ms,checked_at,updated_at",
    )
    .order("target_kind", { ascending: true })
    .order("target_name", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformHealthSnapshot[];
}

export async function listPlatformHealthEvents(limit = 100): Promise<PlatformHealthEvent[]> {
  const safeLimit = Math.max(1, Math.min(300, limit));
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_health_events")
    .select(
      "id,target_kind,target_id,target_name,state,severity,event_type,message,details,latency_ms,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) throw new Error(error.message);
  return (data ?? []) as PlatformHealthEvent[];
}

/** Start a single in-process 20-minute scheduler (local/long-lived Node). */
export function startPlatformHealthScheduler(): void {
  if (schedulerStarted) return;
  if (typeof setInterval === "undefined") return;
  schedulerStarted = true;

  const tick = () => {
    void runPlatformHealthScan().then((result) => {
      if (!result.ok) {
        console.warn("[platform-health] scheduled scan skipped/failed:", result.error);
        return;
      }
      console.info("[platform-health] scheduled scan ok", {
        companies: result.companies_checked,
        branches: result.branches_checked,
        issues: result.issues,
        ms: result.duration_ms,
      });
    });
  };

  // First scan shortly after boot (avoid competing with cold start).
  setTimeout(tick, 15_000);
  setInterval(tick, PLATFORM_HEALTH_INTERVAL_MS);
}
