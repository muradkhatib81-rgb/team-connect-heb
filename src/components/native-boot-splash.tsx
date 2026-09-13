import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNativeApp } from "@/lib/native-app";
import { cn } from "@/lib/utils";

const MIN_VISIBLE_MS = 1400;
const GROW_MS = 1400;
const FADE_MS = 380;
const HARD_TIMEOUT_MS = 4500;

/** Survives React remounts in the same WebView session; resets on cold start. */
let nativeBootSplashPlayed = false;

function hideNativeSplash() {
  void SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {});
}

/**
 * Native cold-start: solid #0f172a native splash hands off into this overlay,
 * which grows the app icon once (small → full) then fades out and unmounts.
 */
export function NativeBootSplash() {
  const [active, setActive] = useState(() => {
    if (typeof window === "undefined") return false;
    return isNativeApp() && !nativeBootSplashPlayed;
  });
  const [leaving, setLeaving] = useState(false);

  useLayoutEffect(() => {
    if (!isNativeApp()) return;
    if (!active) {
      hideNativeSplash();
      return;
    }
    let cancelled = false;
    const hide = () => {
      if (!cancelled) hideNativeSplash();
    };
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(hide);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [active]);

  useEffect(() => {
    if (!isNativeApp()) {
      setActive(false);
      return;
    }
    if (!active) return;

    const started = Date.now();
    let cancelled = false;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;

    const dismiss = () => {
      if (cancelled || nativeBootSplashPlayed) return;
      nativeBootSplashPlayed = true;
      setLeaving(true);
      removeTimer = setTimeout(() => {
        if (!cancelled) setActive(false);
      }, FADE_MS);
    };

    const finish = () => {
      if (cancelled) return;
      const elapsed = Date.now() - started;
      const wait = Math.max(GROW_MS, MIN_VISIBLE_MS) - elapsed;
      fadeTimer = setTimeout(dismiss, Math.max(0, wait));
    };

    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });

    const fallback = window.setTimeout(finish, 2200);
    const hard = window.setTimeout(dismiss, HARD_TIMEOUT_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      window.clearTimeout(hard);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (removeTimer) clearTimeout(removeTimer);
      window.removeEventListener("load", finish);
    };
  }, [active]);

  if (!active || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden
      className={cn(
        "pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f172a] transition-opacity duration-300",
        leaving ? "opacity-0" : "opacity-100",
      )}
    >
      <style>{`
        @keyframes native-boot-grow {
          from { transform: scale(0.34); opacity: 0.85; }
          to { transform: scale(1); opacity: 1; }
        }
      `}</style>
      <img
        src="/icons/icon-512.png"
        alt=""
        width={168}
        height={168}
        draggable={false}
        className="native-boot-logo h-[7.5rem] w-[7.5rem] rounded-[1.75rem] object-contain shadow-lg select-none pointer-events-none"
        style={{
          transform: "scale(0.34)",
          transformOrigin: "center center",
          animation: `native-boot-grow ${GROW_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards`,
        }}
      />
    </div>,
    document.body,
  );
}
