import { useEffect, useLayoutEffect, useRef } from "react";

/**
 * Signs the user out after a fixed period of inactivity.
 *
 * Only real user interaction (pointer, keyboard, touch, scroll) resets the
 * countdown. Opening or focusing the app does NOT extend the session.
 * The timer survives across tabs via a shared localStorage timestamp.
 */
export const IDLE_LOGOUT_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

const LAST_ACTIVITY_STORAGE_KEY = "tc:last-activity-at";
const IDLE_SESSION_USER_KEY = "tc:idle-session-user-id";

const WINDOW_ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "scroll",
  "wheel",
];

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Ignore storage failures (private mode, quota, etc.)
  }
}

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures
  }
}

/** Clears idle tracking — call on explicit sign-out. */
export function clearIdleSessionState() {
  if (typeof window === "undefined") return;
  removeStorage(LAST_ACTIVITY_STORAGE_KEY);
  removeStorage(IDLE_SESSION_USER_KEY);
}

/** Starts or resets the idle window for a fresh login. */
export function seedIdleSessionOnLogin(userId: string) {
  if (typeof window === "undefined") return;
  writeStorage(IDLE_SESSION_USER_KEY, userId);
  writeStorage(LAST_ACTIVITY_STORAGE_KEY, String(Date.now()));
}

function readLastActivityForUser(userId: string): number | null {
  if (readStorage(IDLE_SESSION_USER_KEY) !== userId) return null;
  const raw = readStorage(LAST_ACTIVITY_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function writeLastActivity(userId: string, ts: number) {
  writeStorage(IDLE_SESSION_USER_KEY, userId);
  writeStorage(LAST_ACTIVITY_STORAGE_KEY, String(ts));
}

export function useIdleLogout(
  onIdle: () => void,
  {
    enabled = true,
    userId,
    timeoutMs = IDLE_LOGOUT_TIMEOUT_MS,
  }: { enabled?: boolean; userId: string; timeoutMs?: number },
) {
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  const firedRef = useRef(false);

  useLayoutEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    firedRef.current = false;
    const lastActivity = readLastActivityForUser(userId);
    if (lastActivity === null) {
      seedIdleSessionOnLogin(userId);
      return;
    }

    if (Date.now() - lastActivity >= timeoutMs) {
      firedRef.current = true;
      onIdleRef.current();
    }
  }, [enabled, timeoutMs, userId]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;
    if (firedRef.current) return;

    let timerId: ReturnType<typeof setTimeout> | undefined;

    const fire = () => {
      if (firedRef.current) return;
      firedRef.current = true;
      onIdleRef.current();
    };

    const schedule = () => {
      if (timerId) clearTimeout(timerId);
      const lastActivity = readLastActivityForUser(userId);
      if (lastActivity === null) {
        seedIdleSessionOnLogin(userId);
        timerId = setTimeout(fire, timeoutMs);
        return;
      }
      const elapsed = Date.now() - lastActivity;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) {
        fire();
        return;
      }
      timerId = setTimeout(fire, remaining);
    };

    const registerActivity = () => {
      if (firedRef.current) return;
      writeLastActivity(userId, Date.now());
      schedule();
    };

    const onStorage = (e: StorageEvent) => {
      if (e.key === LAST_ACTIVITY_STORAGE_KEY || e.key === IDLE_SESSION_USER_KEY) {
        schedule();
      }
    };

    // Start countdown from the stored timestamp — do NOT reset on mount.
    schedule();

    for (const evt of WINDOW_ACTIVITY_EVENTS) {
      window.addEventListener(evt, registerActivity, { passive: true });
    }
    window.addEventListener("storage", onStorage);

    return () => {
      if (timerId) clearTimeout(timerId);
      for (const evt of WINDOW_ACTIVITY_EVENTS) {
        window.removeEventListener(evt, registerActivity);
      }
      window.removeEventListener("storage", onStorage);
    };
  }, [enabled, timeoutMs, userId]);
}
