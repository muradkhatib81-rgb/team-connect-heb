import { useEffect, useRef, useState } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { combineToIso } from "@/lib/date-format";
import { supabase } from "@/integrations/supabase/client";
import i18n from "@/i18n";

/** Explicit break request statuses — never infer from timestamps alone. */
export type BreakRequestStatus =
  | "scheduled"
  | "pending_approval"
  | "approved"
  | "waiting_for_start"
  | "active"
  | "completed"
  | "rejected"
  | "ended_by_manager"
  | "cancelled"
  | "cancelled_by_employee"
  | "cancelled_by_manager"
  | "pending";

/** @deprecated Use getBreakStatusLabel() for display */
export const BREAK_STATUS_LABEL: Record<string, string> = {
  scheduled: "נקבעה",
  pending_approval: "ממתינה לאישור",
  pending: "ממתינה לאישור",
  approved: "אושרה",
  waiting_for_start: "ממתינה להתחלה",
  active: "פעילה",
  completed: "הסתיימה",
  rejected: "נדחתה",
  ended_by_manager: "הסתיימה על ידי מנהל",
  cancelled: "בוטלה",
  cancelled_by_employee: "בוטל ע״י עובד",
  cancelled_by_manager: "בוטל ע״י מנהל",
};

export function getBreakStatusLabel(status: string): string {
  const key = `breaks.status.${status}`;
  const translated = i18n.t(key);
  return translated !== key ? translated : status;
}

export const BREAK_STATUS_TONE: Record<
  string,
  "default" | "secondary" | "destructive" | "outline"
> = {
  scheduled: "secondary",
  pending_approval: "secondary",
  pending: "secondary",
  approved: "default",
  waiting_for_start: "outline",
  active: "default",
  completed: "outline",
  rejected: "destructive",
  ended_by_manager: "destructive",
  cancelled: "destructive",
  cancelled_by_employee: "destructive",
  cancelled_by_manager: "destructive",
};

/** Pre-active statuses where the break is confirmed but not yet running. */
export const BREAK_PRE_ACTIVE_STATUSES = [
  "scheduled",
  "approved",
  "waiting_for_start",
] as const;

export const BREAK_PENDING_APPROVAL_STATUSES = ["pending_approval", "pending"] as const;

/** Statuses where employee/manager may edit or cancel. */
export const BREAK_EDITABLE_STATUSES = [
  "pending_approval",
  "scheduled",
  "approved",
  "waiting_for_start",
] as const;

export const BREAK_TERMINAL_STATUSES = [
  "completed",
  "rejected",
  "ended_by_manager",
  "cancelled",
  "cancelled_by_employee",
  "cancelled_by_manager",
] as const;

/** Statuses that consume the one-per-shift slot for a break type (matches DB). */
export const BREAK_CONSUMED_STATUSES = [
  "scheduled",
  "pending_approval",
  "approved",
  "waiting_for_start",
  "active",
  "completed",
  "ended_by_manager",
] as const;

export function isBreakTypeConsumedStatus(status: string) {
  return (BREAK_CONSUMED_STATUSES as readonly string[]).includes(status);
}

export function consumedBreakSettingIds(
  breaks: ReadonlyArray<{ break_setting_id: string; status: string }>,
): Set<string> {
  const ids = new Set<string>();
  for (const b of breaks) {
    if (isBreakTypeConsumedStatus(b.status)) ids.add(b.break_setting_id);
  }
  return ids;
}

export function consumedBreakSettingIdsForJerusalemDay(
  breaks: ReadonlyArray<{
    break_setting_id: string;
    status: string;
    planned_start?: string | null;
    requested_at?: string | null;
  }>,
  day: string,
): Set<string> {
  const ids = new Set<string>();
  for (const b of breaks) {
    if (!isBreakTypeConsumedStatus(b.status)) continue;
    const start = b.planned_start ?? b.requested_at;
    if (!start) continue;
    const breakDay = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Jerusalem",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(start));
    if (breakDay === day) ids.add(b.break_setting_id);
  }
  return ids;
}

export function isBreakEditable(status: string) {
  return (BREAK_EDITABLE_STATUSES as readonly string[]).includes(status);
}

export function fmtBreakTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

/** Convert HH:MM (Asia/Jerusalem wall clock) to UTC ISO — matches `toLocalTime` / `fmtBreakTime`. */
export function isoFromLocalTime(timeStr: string, baseDate?: Date): string {
  const ref = baseDate ?? new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ref);
  const iso = combineToIso(dateStr, timeStr);
  if (!iso) throw new Error(i18n.t("breaks.invalidTime", { time: timeStr }));
  return iso;
}

export function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  const mm = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hh}:${mm}`;
}

export function todayJerusalemDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Calendar date (YYYY-MM-DD) in Asia/Jerusalem for an instant. */
export function toJerusalemDate(iso: string | Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** True if the break belongs to the given Jerusalem calendar day (or is still active). */
export function isBreakOnJerusalemDay(
  row: {
    status?: string | null;
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at?: string | null;
    created_at?: string | null;
    started_at?: string | null;
  },
  day: string,
): boolean {
  if (row.status === "active") return true;
  const start =
    row.started_at ??
    row.planned_start ??
    row.approved_at_time ??
    row.requested_at ??
    row.created_at;
  if (!start) return false;
  return toJerusalemDate(start) === day;
}

export function breakStartIso(row: {
  planned_start?: string | null;
  approved_at_time?: string | null;
  requested_at: string;
  started_at?: string | null;
}) {
  return row.started_at ?? row.planned_start ?? row.approved_at_time ?? row.requested_at;
}

export function sortBreaksByStart<
  T extends {
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at: string;
    started_at?: string | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(breakStartIso(a)).getTime();
    const tb = new Date(breakStartIso(b)).getTime();
    return tb - ta;
  });
}

/** Earliest scheduled start first — used for "next upcoming" break selection. */
export function sortBreaksByStartAsc<
  T extends {
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at: string;
    started_at?: string | null;
  },
>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ta = new Date(breakStartIso(a)).getTime();
    const tb = new Date(breakStartIso(b)).getTime();
    return ta - tb;
  });
}

export function pickActiveBreak<
  T extends { status: string },
>(rows: T[]): T | null {
  return rows.find((r) => r.status === "active") ?? null;
}

/** Earliest pre-active break, optionally excluding one row (e.g. current active). */
export function pickUpcomingBreak<
  T extends {
    id: string;
    status: string;
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at: string;
    started_at?: string | null;
  },
>(rows: T[], excludeId?: string): T | null {
  const preActive = rows.filter(
    (r) =>
      r.id !== excludeId &&
      (BREAK_PRE_ACTIVE_STATUSES as readonly string[]).includes(r.status),
  );
  return sortBreaksByStartAsc(preActive)[0] ?? null;
}

/** Active break first; otherwise the earliest upcoming pre-active break. */
export function pickPrimaryBreak<
  T extends {
    id: string;
    status: string;
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at: string;
    started_at?: string | null;
  },
>(rows: T[]): T | null {
  if (!rows.length) return null;
  const active = rows.find((r) => r.status === "active");
  if (active) return active;
  const preActive = rows.filter((r) =>
    (BREAK_PRE_ACTIVE_STATUSES as readonly string[]).includes(r.status),
  );
  return sortBreaksByStartAsc(preActive)[0] ?? null;
}

/** Next scheduled break after the primary one (for dashboard preview). */
export function pickNextScheduledBreak<
  T extends {
    id: string;
    status: string;
    planned_start?: string | null;
    approved_at_time?: string | null;
    requested_at: string;
    started_at?: string | null;
  },
>(rows: T[], excludeId?: string): T | null {
  return pickUpcomingBreak(rows, excludeId);
}

/**
 * Countdown → 00:00 → red count-up for active breaks.
 * Source of truth is server `endsAt`.
 */
/** Polls activation RPCs so scheduled breaks flip to active at start time. */
export function useActivateDueBreaksPoll(
  userId: string | undefined,
  qc: QueryClient,
  opts?: { plannedStartIso?: string | null; isActive?: boolean },
) {
  const activatingRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;

    const invalidate = () => {
      qc.invalidateQueries({ queryKey: ["my-break-shortcut", userId] });
      qc.invalidateQueries({ queryKey: ["my-active-break", userId] });
      qc.invalidateQueries({ queryKey: ["dashboard-on-break"] });
      qc.invalidateQueries({ queryKey: ["dashboard-daily-breaks"] });
      qc.invalidateQueries({ queryKey: ["my-breaks-today"] });
    };

    const runActivation = async () => {
      if (activatingRef.current) return;
      activatingRef.current = true;
      try {
        // Per-user activation only — global activate_due_break_requests runs on pg_cron
        // every minute; calling it from every open browser was redundant load.
        const { error: userErr } = await (supabase as any).rpc("activate_due_breaks_for_user", {
          _user_id: userId,
        });
        if (userErr) {
          console.error("[break-activation] activate_due_breaks_for_user failed:", userErr.message);
        }
        if (!cancelled && !userErr) invalidate();
      } finally {
        activatingRef.current = false;
      }
    };

    void runActivation();
    // Backup only — pg_cron + due setTimeout handle timely activation.
    const intervalMs =
      opts?.plannedStartIso && !opts?.isActive ? 30_000 : 60_000;
    const id = setInterval(() => void runActivation(), intervalMs);

    let dueTimer: ReturnType<typeof setTimeout> | undefined;
    if (opts?.plannedStartIso && !opts?.isActive) {
      const dueMs = new Date(opts.plannedStartIso).getTime() - Date.now();
      if (dueMs <= 0) {
        void runActivation();
      } else if (dueMs < 86_400_000) {
        dueTimer = setTimeout(() => void runActivation(), dueMs + 250);
      }
    }

    return () => {
      cancelled = true;
      clearInterval(id);
      if (dueTimer) clearTimeout(dueTimer);
    };
  }, [userId, qc, opts?.plannedStartIso, opts?.isActive]);
}

export function BreakLiveTimer({ endsAt }: { endsAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const endMs = new Date(endsAt).getTime();
  const diffMs = endMs - now;
  const overrun = diffMs <= 0;
  const abs = Math.abs(diffMs);
  const mm = String(Math.floor(abs / 60000)).padStart(2, "0");
  const ss = String(Math.floor((abs % 60000) / 1000)).padStart(2, "0");

  return (
    <p
      className={
        "mt-1 text-sm font-mono tabular-nums " +
        (overrun ? "text-red-600 font-bold" : "text-foreground")
      }
      dir="ltr"
      aria-live="polite"
    >
      {overrun ? "+" : ""}
      {mm}:{ss}
    </p>
  );
}
