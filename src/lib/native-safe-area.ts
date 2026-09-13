import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativeApp, isNativeIOS } from "@/lib/native-app";

/** Used only when the WebView reports 0 for env(safe-area-inset-top). */
const ANDROID_FALLBACK_TOP_PX = 32;
const IOS_FALLBACK_TOP_PX = 50;

function readEnvInset(side: "top" | "right" | "bottom" | "left"): number {
  if (typeof document === "undefined") return 0;
  const el = document.createElement("div");
  el.style.position = "absolute";
  el.style.visibility = "hidden";
  el.style.pointerEvents = "none";
  const prop = `padding-${side}`;
  el.style.setProperty(prop, `env(safe-area-inset-${side}, 0px)`);
  document.body.appendChild(el);
  const value = parseFloat(getComputedStyle(el).getPropertyValue(prop)) || 0;
  el.remove();
  return value;
}

function applySafeAreaVars() {
  const root = document.documentElement;
  const envTop = readEnvInset("top");
  const envRight = readEnvInset("right");
  const envBottom = readEnvInset("bottom");
  const envLeft = readEnvInset("left");

  let top = envTop;
  // Android WebView often reports 0 even when the status bar overlays content.
  if (isNativeApp() && top < 20) {
    top = isNativeIOS() ? IOS_FALLBACK_TOP_PX : ANDROID_FALLBACK_TOP_PX;
  }

  root.style.setProperty("--app-safe-top", `${top}px`);
  root.style.setProperty("--app-safe-right", `${Math.max(envRight, 0)}px`);
  root.style.setProperty("--app-safe-bottom", `${Math.max(envBottom, 0)}px`);
  root.style.setProperty("--app-safe-left", `${Math.max(envLeft, 0)}px`);
}

/**
 * Draw edge-to-edge, then expose safe-area insets as --app-safe-* so
 * headers/modals can clear the status bar on Capacitor Android/iOS.
 */
export function installNativeSafeArea() {
  if (typeof document === "undefined") return () => {};
  // Browser / iOS PWA: keep live env(safe-area-inset-*) from CSS.
  if (!isNativeApp()) return () => {};

  const root = document.documentElement;
  root.dataset.nativeApp = "true";

  applySafeAreaVars();

  void StatusBar.setOverlaysWebView({ overlay: true })
    .then(() => applySafeAreaVars())
    .catch(() => {});
  void StatusBar.setStyle({ style: Style.Light }).catch(() => {});

  const onResize = () => applySafeAreaVars();
  window.addEventListener("resize", onResize);
  window.visualViewport?.addEventListener("resize", onResize);

  return () => {
    window.removeEventListener("resize", onResize);
    window.visualViewport?.removeEventListener("resize", onResize);
  };
}
