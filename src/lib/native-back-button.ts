import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { toast } from "sonner";
import i18n from "@/i18n";
import { isNativeAndroid, isNativeApp } from "@/lib/native-app";

/** Window to confirm a second back press before leaving the app. */
export const NATIVE_EXIT_CONFIRM_MS = 2500;

/**
 * Count of in-app pushState navigations since this JS context started.
 * Replaces and the initial document load do not increment, so the first
 * screen (dashboard / platform / auth) stays at depth 0 — back then asks
 * for a second press instead of looping through "/" redirects.
 */
let inAppDepth = 0;
let historyPatched = false;
/** Timestamp until which a second back at root will leave the app. */
let exitArmedUntil = 0;

/**
 * Root screens: hardware / system back means "leave app" (after confirm),
 * not history.back(). Shared by Android today and iOS hooks later.
 */
export function isNativeRootPath(pathname: string): boolean {
  const p = (pathname.replace(/\/+$/, "") || "/").split("?")[0] ?? "/";
  return (
    p === "/" ||
    p === "/dashboard" ||
    p === "/platform" ||
    p === "/auth" ||
    p === "/inactive" ||
    p === "/change-password"
  );
}

function patchHistoryDepthTracking(): void {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;

  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    inAppDepth += 1;
    exitArmedUntil = 0;
    return origPush(...args);
  };

  const origReplace = window.history.replaceState.bind(window.history);
  window.history.replaceState = (...args: Parameters<History["replaceState"]>) => {
    const url = args[2];
    if (typeof url === "string") {
      try {
        const path = new URL(url, window.location.origin).pathname;
        // Login / logout / access redirects use replace onto a root screen —
        // that must restart the back stack so the next back is "exit confirm".
        if (isNativeRootPath(path)) {
          inAppDepth = 0;
          exitArmedUntil = 0;
        }
      } catch {
        /* ignore bad URLs */
      }
    }
    return origReplace(...args);
  };

  window.addEventListener("popstate", () => {
    inAppDepth = Math.max(0, inAppDepth - 1);
    exitArmedUntil = 0;
  });
}

function dismissOpenOverlay(): boolean {
  const open = document.querySelector(
    '[data-state="open"][role="dialog"], [data-state="open"][role="alertdialog"], [data-state="open"][role="menu"], [data-state="open"][role="listbox"]',
  );
  if (!open) return false;
  document.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Escape",
      code: "Escape",
      bubbles: true,
      cancelable: true,
    }),
  );
  return true;
}

function leaveApp(): void {
  void App.minimizeApp().catch(() => {
    void App.exitApp();
  });
}

function showPressAgainToExit(): void {
  toast.info(i18n.t("native.pressBackAgainToExit"), {
    id: "native-press-back-again",
    duration: NATIVE_EXIT_CONFIRM_MS,
  });
}

/**
 * Shared native back policy (Android hardware button now; call from an iOS
 * edge-swipe / custom back hook later):
 * 1) Close open overlays
 * 2) Pop in-app history until the session root (home)
 * 3) On root: first press shows a localized toast; second within the window leaves
 */
export function handleNativeBack(): void {
  if (typeof window === "undefined") return;
  if (dismissOpenOverlay()) return;

  const pathname = window.location.pathname;

  if (inAppDepth > 0) {
    window.history.back();
    return;
  }

  // Depth 0 on a deep URL (stale history / old deep link): open home once
  // via `/` so resolveLandingPath picks dashboard vs platform for this user.
  if (!isNativeRootPath(pathname)) {
    exitArmedUntil = 0;
    window.location.replace(`${window.location.origin}/`);
    return;
  }

  const now = Date.now();
  if (now < exitArmedUntil) {
    exitArmedUntil = 0;
    leaveApp();
    return;
  }
  exitArmedUntil = now + NATIVE_EXIT_CONFIRM_MS;
  showPressAgainToExit();
}

/**
 * Installs history depth tracking on all native shells, and the Android
 * hardware back listener. iOS has no system back button; reuse
 * `handleNativeBack` when adding a gesture / UI back later.
 */
export function installNativeBackButton(): () => void {
  if (!isNativeApp() || typeof window === "undefined") return () => {};

  patchHistoryDepthTracking();

  // Capacitor `backButton` is Android-only today.
  if (!isNativeAndroid()) return () => {};

  let cancelled = false;
  let handle: PluginListenerHandle | undefined;

  void App.addListener("backButton", () => {
    handleNativeBack();
  }).then((h) => {
    if (cancelled) {
      void h.remove();
      return;
    }
    handle = h;
  });

  return () => {
    cancelled = true;
    void handle?.remove();
  };
}
