import { useEffect, useState } from "react";
import { SplashScreen } from "@capacitor/splash-screen";
import { isNativeApp } from "@/lib/native-app";
import { cn } from "@/lib/utils";

const MIN_VISIBLE_MS = 1400;
const FADE_MS = 380;

/**
 * Native cold-start: logo starts small and grows until the web shell is ready.
 * Hides the Capacitor splash as soon as this overlay is up (same background).
 */
export function NativeBootSplash() {
  const [active, setActive] = useState(() => (typeof window !== "undefined" ? isNativeApp() : false));
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!isNativeApp()) {
      setActive(false);
      return;
    }

    const started = Date.now();
    let cancelled = false;
    let fadeTimer: ReturnType<typeof setTimeout> | null = null;
    let removeTimer: ReturnType<typeof setTimeout> | null = null;

    void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});

    const finish = () => {
      if (cancelled) return;
      const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - started));
      fadeTimer = setTimeout(() => {
        if (cancelled) return;
        setLeaving(true);
        removeTimer = setTimeout(() => {
          if (!cancelled) setActive(false);
        }, FADE_MS);
      }, wait);
    };

    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });

    // Fallback if load never fires (SPA / remote shell already interactive)
    const fallback = window.setTimeout(finish, 2200);

    return () => {
      cancelled = true;
      window.clearTimeout(fallback);
      if (fadeTimer) clearTimeout(fadeTimer);
      if (removeTimer) clearTimeout(removeTimer);
      window.removeEventListener("load", finish);
    };
  }, []);

  if (!active) return null;

  return (
    <div
      aria-hidden
      className={cn(
        "fixed inset-0 z-[9999] flex items-center justify-center bg-[#0f172a] transition-opacity duration-300",
        leaving ? "opacity-0 pointer-events-none" : "opacity-100",
      )}
    >
      <img
        src="/icons/icon-512.png"
        alt=""
        width={168}
        height={168}
        draggable={false}
        className="native-boot-logo h-[7.5rem] w-[7.5rem] rounded-[1.75rem] object-contain shadow-lg select-none"
      />
    </div>
  );
}
