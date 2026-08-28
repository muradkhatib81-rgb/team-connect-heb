/**
 * Platform-time authority.
 *
 * The whole application MUST derive "now" from this module rather than calling
 * `new Date()` in feature code. It resolves the platform-wide time zone once
 * (defaults to `Asia/Jerusalem`) and exposes helpers that compute the current
 * platform-zone HH:MM / date, boundary-aware React tickers, and shift-window
 * containment for values that may cross midnight.
 *
 * Every time-based module (Weekly Schedule, Employee Schedule, Main Dashboard,
 * Main Board, Notifications, Breaks, future attendance / payroll) should
 * consume these helpers so behavior stays identical for every viewer.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getServerNow } from "./platform-time.functions";

const DEFAULT_TZ = "Asia/Jerusalem";
let cachedTz: string | null = null;

async function loadPlatformTimeZone(): Promise<string> {
  if (cachedTz) return cachedTz;
  try {
    const { data } = await supabase
      .from("company_settings")
      .select("extra")
      .eq("is_active", true)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const tz =
      (data as { extra?: { time_zone?: string } } | null)?.extra?.time_zone?.trim() ||
      DEFAULT_TZ;
    cachedTz = tz;
    return tz;
  } catch {
    cachedTz = DEFAULT_TZ;
    return DEFAULT_TZ;
  }
}

/** React hook: returns the platform time zone (never changes at runtime). */
export function usePlatformTimeZone(): string {
  const q = useQuery({
    queryKey: ["platform-time-zone"],
    queryFn: loadPlatformTimeZone,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return q.data ?? DEFAULT_TZ;
}

/** Server-time offset in ms (server - client). Applied inside `platformNow`. */
let serverOffsetMs = 0;

/** Sync the client clock against the server clock. Runs once per session. */
export function usePlatformClockSync() {
  const fetchNow = useServerFn(getServerNow);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    (async () => {
      const t0 = Date.now();
      try {
        const { nowISO } = await fetchNow();
        const t1 = Date.now();
        const serverNow = new Date(nowISO).getTime();
        // Estimate one-way latency as half the round trip
        const latency = Math.max(0, (t1 - t0) / 2);
        serverOffsetMs = serverNow - (t1 - latency);
      } catch {
        // fall back to local clock
        serverOffsetMs = 0;
      }
    })();
  }, [fetchNow]);
}

/** Current instant, corrected for measured server offset. */
export function platformNow(): Date {
  return new Date(Date.now() + serverOffsetMs);
}

type PlatformParts = {
  dateISO: string; // YYYY-MM-DD in platform TZ
  hhmm: string;    // HH:MM in platform TZ
  minutesOfDay: number;
};

/** Break a Date into its platform-zone date / HH:MM / minute-of-day parts. */
export function toPlatformParts(date: Date, timeZone: string): PlatformParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const dateISO = `${get("year")}-${get("month")}-${get("day")}`;
  const hh = get("hour").replace("24", "00");
  const mm = get("minute");
  return {
    dateISO,
    hhmm: `${hh}:${mm}`,
    minutesOfDay: Number(hh) * 60 + Number(mm),
  };
}

/** Parse a `HH:MM` or `HH:MM:SS` string into minutes-of-day (0..1439). */
export function parseHHMMToMinutes(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(mm)) return null;
  return h * 60 + mm;
}

/** Format `HH:MM:SS` / `HH:MM` as `HH:MM` (24h). */
export function formatHHMM(s: string | null | undefined): string {
  if (!s) return "";
  const m = /^(\d{1,2}):(\d{2})/.exec(s);
  if (!m) return "";
  return `${m[1].padStart(2, "0")}:${m[2]}`;
}

/**
 * True when `nowMinutes` is inside the window `[start, end]`, handling ranges
 * that cross midnight (e.g. 22:00 → 06:00). "Appear at start; disappear after end".
 */
export function isWithinShiftWindow(
  startMin: number | null,
  endMin: number | null,
  nowMin: number,
): boolean {
  if (startMin == null || endMin == null) return false;
  if (startMin === endMin) return nowMin === startMin;
  if (startMin < endMin) return nowMin >= startMin && nowMin <= endMin;
  // Crosses midnight
  return nowMin >= startMin || nowMin <= endMin;
}

/**
 * Compute the ms until the next relevant boundary (start or end) so callers
 * can schedule a `setTimeout` that fires exactly when a shift begins or ends.
 */
export function nextBoundaryDelayMs(
  boundaries: number[],
  nowMin: number,
  safetyMs = 60_000,
): number {
  let bestDeltaMin = Infinity;
  for (const b of boundaries) {
    let delta = b - nowMin;
    if (delta <= 0) delta += 24 * 60;
    if (delta < bestDeltaMin) bestDeltaMin = delta;
  }
  if (!Number.isFinite(bestDeltaMin)) return safetyMs;
  const ms = bestDeltaMin * 60_000 + 250; // small overshoot
  return Math.min(ms, safetyMs);
}

/**
 * Boundary-aware ticker: re-renders when the platform clock crosses one of
 * the supplied HH:MM boundaries (converted to minute-of-day). Falls back to
 * a 60 s safety tick when no boundaries are supplied.
 */
export function usePlatformNow(boundariesHHMM: (string | null | undefined)[] = []) {
  const tz = usePlatformTimeZone();
  usePlatformClockSync();
  const [tick, setTick] = useState(0);

  const boundaryKey = boundariesHHMM
    .filter((v): v is string => !!v)
    .map(formatHHMM)
    .sort()
    .join(",");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const now = platformNow();
      const parts = toPlatformParts(now, tz);
      const boundaries = boundaryKey
        .split(",")
        .filter(Boolean)
        .map((b) => parseHHMMToMinutes(b))
        .filter((n): n is number => n != null);
      const delay = nextBoundaryDelayMs(boundaries, parts.minutesOfDay);
      timer = setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, Math.max(500, delay));
    };
    schedule();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [tz, boundaryKey]);

  const now = platformNow();
  const parts = toPlatformParts(now, tz);
  return { now, tz, ...parts, tick };
}
