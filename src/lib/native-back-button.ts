import { App } from "@capacitor/app";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativeAndroid } from "@/lib/native-app";

/**
 * Count of in-app pushState navigations since this JS context started.
 * Replaces and the initial document load do not increment, so the first
 * screen (dashboard / platform / auth) stays at depth 0 — the last back
 * can leave the Android app instead of looping through "/" redirects.
 */
let inAppDepth = 0;
let historyPatched = false;

function patchHistoryDepthTracking(): void {
  if (historyPatched || typeof window === "undefined") return;
  historyPatched = true;
  const origPush = window.history.pushState.bind(window.history);
  window.history.pushState = (...args: Parameters<History["pushState"]>) => {
    inAppDepth += 1;
    return origPush(...args);
  };
  window.addEventListener("popstate", () => {
    inAppDepth = Math.max(0, inAppDepth - 1);
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

/**
 * Android hardware back: close overlays, then pop in-app pages, then leave
 * the app when the session is back on its first screen.
 */
export function installNativeBackButton(): () => void {
  if (!isNativeAndroid() || typeof window === "undefined") return () => {};

  patchHistoryDepthTracking();

  let cancelled = false;
  let handle: PluginListenerHandle | undefined;

  void App.addListener("backButton", () => {
    if (dismissOpenOverlay()) return;
    if (inAppDepth > 0) {
      window.history.back();
      return;
    }
    leaveApp();
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
