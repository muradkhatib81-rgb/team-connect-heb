import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { refreshPageData } from "@/lib/refresh-page-data";

const THRESHOLD = 56;
const MAX_PULL = 88;
/** Ignore jitter so a tap is not treated as a pull (preventDefault cancels click). */
const PULL_ARM_DELTA = 16;

function pageScrollTop(): number {
  return Math.max(
    window.scrollY || 0,
    document.documentElement.scrollTop || 0,
    document.body?.scrollTop || 0,
    window.visualViewport?.pageTop || 0,
  );
}

function nestedScrollerNotAtTop(target: EventTarget | null): boolean {
  let node = target instanceof HTMLElement ? target : null;
  while (node && node !== document.body) {
    const { overflowY } = window.getComputedStyle(node);
    if ((overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") && node.scrollTop > 1) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== document.documentElement) {
    const tag = node.tagName;
    if (/^(A|BUTTON|INPUT|SELECT|TEXTAREA|SUMMARY|LABEL)$/.test(tag)) return true;
    const role = node.getAttribute("role");
    if (role && /^(button|link|menuitem|menuitemradio|combobox|tab|switch|checkbox|slider)$/i.test(role)) {
      return true;
    }
    if (node.getAttribute("aria-haspopup")) return true;
    node = node.parentElement;
  }
  return false;
}

/** Mobile pull-down to refetch the current page (same gesture as native apps). */
export function PullToRefresh({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const pulling = useRef(false);
  const armed = useRef(false);
  const pullRef = useRef(0);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setPull(THRESHOLD);
    try {
      await refreshPageData(qc, router);
    } finally {
      pullRef.current = 0;
      setRefreshing(false);
      setPull(0);
    }
  }, [qc, router]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 1023px)");
    if (!mq.matches) return;

    const onStart = (e: TouchEvent) => {
      if (refreshing) return;
      if (isInteractiveTarget(e.target)) {
        armed.current = false;
        return;
      }
      if (pageScrollTop() > 0 || nestedScrollerNotAtTop(e.target)) {
        armed.current = false;
        return;
      }
      armed.current = true;
      pulling.current = false;
      startY.current = e.touches[0]?.clientY ?? 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed.current || refreshing) return;
      const y = e.touches[0]?.clientY ?? 0;
      const delta = y - startY.current;
      if (delta < PULL_ARM_DELTA) return;
      if (pageScrollTop() > 0) {
        armed.current = false;
        pulling.current = false;
        setPull(0);
        return;
      }
      pulling.current = true;
      // Only cancel the click once this is clearly a pull, not a tap.
      if (e.cancelable) e.preventDefault();
      const damped = Math.min(MAX_PULL, delta * 0.45);
      pullRef.current = damped;
      setPull(damped);
    };

    const onEnd = () => {
      if (!armed.current) return;
      armed.current = false;
      const shouldRefresh = pulling.current && pullRef.current >= THRESHOLD;
      pulling.current = false;
      if (shouldRefresh) void refresh();
      else {
        pullRef.current = 0;
        setPull(0);
      }
    };

    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    document.addEventListener("touchcancel", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
      document.removeEventListener("touchcancel", onEnd);
    };
  }, [refresh, refreshing]);

  const visible = pull > 4 || refreshing;

  return (
    <div className="relative min-w-0 max-w-full">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center transition-opacity"
        style={{
          height: 48,
          opacity: visible ? 1 : 0,
          transform: `translateY(${Math.max(0, pull - 8)}px)`,
        }}
        aria-hidden={!visible}
      >
        <Loader2
          className={`size-6 text-primary ${refreshing || pull >= THRESHOLD ? "animate-spin" : ""}`}
        />
      </div>
      <div
        style={{
          transform: pull > 0 ? `translateY(${pull}px)` : undefined,
          transition: pulling.current || refreshing ? undefined : "transform 180ms ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
