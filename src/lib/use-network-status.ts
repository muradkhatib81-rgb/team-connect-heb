import { useEffect, useState } from "react";

function readOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

/**
 * Browser online/offline + light reachability check.
 * Captive portals may still report navigator.onLine=true; heartbeat corrects that.
 */
export function useNetworkStatus() {
  const [online, setOnline] = useState(readOnline);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const apply = (next: boolean) => {
      if (!cancelled) setOnline(next);
    };

    const onOnline = () => apply(true);
    const onOffline = () => apply(false);

    const heartbeat = async () => {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        apply(false);
        return;
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(`/api/pwa-manifest?ping=${Date.now()}`, {
          method: "GET",
          cache: "no-store",
          signal: ctrl.signal,
        });
        clearTimeout(t);
        apply(res.ok);
      } catch {
        apply(false);
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void heartbeat();
    timer = setInterval(() => void heartbeat(), 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      if (timer) clearInterval(timer);
    };
  }, []);

  return { online };
}
