import { useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNativeApp } from "@/lib/native-app";
import { cn } from "@/lib/utils";

const MIN_VISIBLE_MS = 1500;
const GROW_MS = 1400;
const FADE_MS = 380;
const HARD_TIMEOUT_MS = 5000;
/** Start clearly small so the grow is unmistakable (not a 0.34→1 flicker). */
const START_SCALE = 0.22;

/** Survives React remounts in the same WebView session; resets on cold start. */
let nativeBootSplashPlayed = false;

function hideNativeSplash() {
  void SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {});
}

function shouldForcePreview(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return new URLSearchParams(window.location.search).has("bootSplash");
  } catch {
    return false;
  }
}

/**
 * Native cold-start: solid #0f172a native splash hands off into this overlay,
 * which grows the app icon once (small → full) then fades out and unmounts.
 *
 * Grow uses a CSS transition from an explicit small scale (not a keyframe
 * that can finish before first paint). Native splash stays solid — no logo.
 */
export function NativeBootSplash() {
  const [active, setActive] = useState(false);
  const [growing, setGrowing] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useLayoutEffect(() => {
    if (shouldForcePreview() && !nativeBootSplashPlayed) {
      setActive(true);
      return;
    }
    if (!isNativeApp()) {
      hideNativeSplash();
      return;
    }
    if (nativeBootSplashPlayed) {
      hideNativeSplash();
      return;
    }
    setActive(true);
  }, []);

  useLayoutEffect(() => {
    if (!active) {
      if (isNativeApp()) hideNativeSplash();
      return;
    }
    let cancelled = false;
    // Paint the icon at START_SCALE first, then hide the solid native splash.
    const outer = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (cancelled) return;
        hideNativeSplash();
        setGrowing(true);
      });
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(outer);
    };
  }, [active]);

  useEffect(() => {
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
      <img
        src="/icons/icon-192.png"
        alt=""
        width={168}
        height={168}
        draggable={false}
        className="h-[7.5rem] w-[7.5rem] rounded-[1.75rem] object-contain shadow-lg select-none pointer-events-none"
        style={{
          transform: growing ? "scale(1)" : `scale(${START_SCALE})`,
          transformOrigin: "center center",
          opacity: growing ? 1 : 0.9,
          transition: growing
            ? `transform ${GROW_MS}ms cubic-bezier(0.33, 0.1, 0.2, 1), opacity ${GROW_MS}ms ease-out`
            : "none",
        }}
      />
    </div>,
    document.body,
  );
}
