import { useEffect, useRef } from "react";

/**
 * Signs the user out after a fixed period of inactivity.
 *
 * "Inactivity" is any absence of user interaction (pointer, keyboard, touch,
 * scroll) or the tab regaining focus. Each interaction resets the countdown.
 * The timer also survives across tabs of the same origin via a shared
 * localStorage timestamp, so activity in one tab keeps the others alive.
 *
 * This is a pure client-side session convenience; it does not touch roles or
 * permissions.
 */
const WINDOW_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

const LAST_ACTIVITY_STORAGE_KEY = "tc:last-activity-at";

export function useIdleLogout(
  onIdle: () => void,
  {
    enabled = true,
    timeoutMs = 12 * 60 * 60 * 1000, // 12 hours
  }: { enabled?: boolean; timeoutMs?: number } = {},
) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const firedRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    firedRef.current = false;
    let timerId: ReturnType<typeof setTimeout> | undefined;

    const readLastActivity = (): number => {
      try {
        const raw = window.localStorage.getItem(LAST_ACTIVITY_STORAGE_KEY);
        const parsed = raw ? Number(raw) : NaN;
        return Number.isFinite(parsed) ? parsed : Date.now();
      } catch {
        return Date.now();
      }
    };

    const writeLastActivity = (ts: number) => {
      try {
        window.localStorage.setItem(LAST_ACTIVITY_STORAGE_KEY, String(ts));
      } catch {
        // Ignore storage failures (private mode, quota, etc.)
      }
    };

    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onIdleRef.current();
    };

    const schedule = () => {
      if (timerId) clearTimeout(timerId);
      const elapsed = Date.now() - readLastActivity();
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) {
        fire();
        return;
      }
      timerId = setTimeout(fire, remaining);
    };

    const registerActivity = () => {
      if (firedRef.current) return;
      // Ignore hidden->hidden churn; only meaningful visibility changes matter.
      writeLastActivity(Date.now());
      schedule();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_STORAGE_KEY) schedule();
    };

    // Seed activity and start the countdown.
    registerActivity();

    for (const evt of WINDOW_ACTIVITY_EVENTS) {
      window.addEventListener(evt, registerActivity, { passive: true });
    }
    document.addEventListener("visibilitychange", registerActivity);
    window.addEventListener("storage", onStorage);

    return () => {
      if (timerId) clearTimeout(timerId);
      for (const evt of WINDOW_ACTIVITY_EVENTS) {
        window.removeEventListener(evt, registerActivity);
      }
      document.removeEventListener("visibilitychange", registerActivity);
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, timeoutMs]);
}
