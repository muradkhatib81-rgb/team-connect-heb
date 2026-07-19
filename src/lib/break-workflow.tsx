import { useEffect, useState } from "react";

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
  | "pending";

export const BREAK_STATUS_LABEL: Record<string, string> = {
  scheduled: "נקבעה",
  pending_approval: "ממתינה לאישור",
  pending: "ממתינה לאישור",
  approved: "אושרה",
  waiting_for_start: "ממתין לתחילה",
  active: "בהפסקה",
  completed: "הסתיימה",
  rejected: "נדחתה",
  ended_by_manager: "הסתיימה על ידי מנהל",
  cancelled: "בוטלה",
};

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
};

/** Pre-active statuses where the break is confirmed but not yet running. */
export const BREAK_PRE_ACTIVE_STATUSES = [
  "scheduled",
  "approved",
  "waiting_for_start",
] as const;

export const BREAK_PENDING_APPROVAL_STATUSES = ["pending_approval", "pending"] as const;

export function fmtBreakTime(iso: string | null) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}

export function isoFromLocalTime(timeStr: string): string {
  const [hh, mm] = timeStr.split(":").map(Number);
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0, 0);
  return d.toISOString();
}

export function toLocalTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Countdown → 00:00 → red count-up for active breaks.
 * Source of truth is server `endsAt`.
 */
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
      {mm}:{ss}
    </p>
  );
}
