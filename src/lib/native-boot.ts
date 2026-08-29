/**
 * Native shell startup — must never touch biometric / secure-storage plugins.
 * Those can hang OEM WebViews if probed during first paint.
 */
import { Capacitor } from "@capacitor/core";
import { isNativeApp } from "@/lib/native-app";

/** Hide the Capacitor / Android 12 splash so it cannot freeze over the live UI. */
export async function hideNativeSplash(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    if (!Capacitor.isPluginAvailable("SplashScreen")) return;
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide({ fadeOutDuration: 150 });
  } catch {
    /* splash already gone or plugin missing — never block the app */
  }
}
