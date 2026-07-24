/**
 * Read-only platform health probes for /platform/monitoring.
 * No writes, no role/permission changes — only light availability checks.
 */

import { supabase } from "@/integrations/supabase/client";
import type { HealthCheckOutcome, IHealthCheck } from "./health-check.interface";
import type { HealthState, HealthTarget } from "./types";

const HEALTHY_MS = 1_500;
const DEGRADED_MS = 4_000;
const REALTIME_TIMEOUT_MS = 5_000;

function stateFromLatency(ms: number, ok: boolean): HealthState {
  if (!ok) return "down";
  if (ms >= DEGRADED_MS) return "degraded";
  if (ms >= HEALTHY_MS) return "degraded";
  return "healthy";
}

function outcome(state: HealthState, message?: string): HealthCheckOutcome {
  return message ? { state, message } : state;
}

async function timed<T>(fn: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();
  const value = await fn();
  const ended = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { ms: Math.round(ended - started), value };
}

/** Env present for Supabase client. */
export async function probeConfiguration(): Promise<HealthCheckOutcome> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    return outcome("down", "חסרים משתני סביבה של Supabase");
  }
  return outcome("healthy", "תצורת החיבור תקינה");
}

/** Auth/API reachability via session path (read-only). */
export async function probeApi(): Promise<HealthCheckOutcome> {
  try {
    const { ms, value } = await timed(() => supabase.auth.getSession());
    if (value.error) {
      return outcome("down", value.error.message);
    }
    return outcome(stateFromLatency(ms, true), `API ${ms}ms`);
  } catch (err) {
    return outcome("down", err instanceof Error ? err.message : "API לא זמין");
  }
}

/** Light DB read against public platform_settings (SELECT allowed). */
export async function probeDatabase(): Promise<HealthCheckOutcome> {
  try {
    const { ms, value } = await timed(() =>
      supabase.from("platform_settings").select("id").eq("id", 1).maybeSingle(),
    );
    if (value.error) {
      return outcome("down", value.error.message);
    }
    return outcome(stateFromLatency(ms, true), `DB ${ms}ms`);
  } catch (err) {
    return outcome("down", err instanceof Error ? err.message : "מסד הנתונים לא זמין");
  }
}

/** List one object from avatars bucket (read-only). */
export async function probeStorage(): Promise<HealthCheckOutcome> {
  try {
    const { ms, value } = await timed(() =>
      supabase.storage.from("avatars").list("", { limit: 1 }),
    );
    if (value.error) {
      return outcome("down", value.error.message);
    }
    return outcome(stateFromLatency(ms, true), `Storage ${ms}ms`);
  } catch (err) {
    return outcome("down", err instanceof Error ? err.message : "אחסון לא זמין");
  }
}

/** Temporary realtime channel subscribe, then remove (no data writes). */
export async function probeRealtime(): Promise<HealthCheckOutcome> {
  const channelName = `platform-health-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = typeof performance !== "undefined" ? performance.now() : Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const channel = supabase.channel(channelName);

    const finish = (state: HealthState, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void supabase.removeChannel(channel);
      resolve(outcome(state, message));
    };

    const timer = setTimeout(() => {
      finish("degraded", `Realtime timeout ${REALTIME_TIMEOUT_MS}ms`);
    }, REALTIME_TIMEOUT_MS);

    channel.subscribe((status) => {
      const ms = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - started,
      );
      if (status === "SUBSCRIBED") {
        finish(stateFromLatency(ms, true), `Realtime ${ms}ms`);
        return;
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        finish("down", `Realtime ${status}`);
      }
    });
  });
}

/** Browser online flag only. */
export async function probeSync(): Promise<HealthCheckOutcome> {
  if (typeof navigator === "undefined") {
    return outcome("unknown", "אין הקשר דפדפן");
  }
  return navigator.onLine
    ? outcome("healthy", "הדפדפן מחובר לרשת")
    : outcome("degraded", "הדפדפן במצב לא מקוון");
}

export class AsyncHealthCheck implements IHealthCheck {
  constructor(
    public readonly target: HealthTarget,
    private readonly probe: () => Promise<HealthCheckOutcome>,
  ) {}

  check(): Promise<HealthCheckOutcome> {
    return this.probe();
  }
}
