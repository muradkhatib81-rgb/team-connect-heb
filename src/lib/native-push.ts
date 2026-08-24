/**
 * Native push (Capacitor + FCM on Android; APNs later on iOS).
 * Closed-app delivery uses FCM's notification payload so the OS shows it
 * even when the WebView is not running.
 */
import { PushNotifications } from "@capacitor/push-notifications";
import { playAlertTone, resolveAlertTone } from "@/lib/alert-tone";
import {
  NATIVE_FCM_TOKEN_EVENT,
  NATIVE_PUSH_OPT_IN_KEY,
  NATIVE_PUSH_OPT_OUT_KEY,
} from "@/lib/fcm-endpoints";
import { isNativeApp, nativePlatform } from "@/lib/native-app";

export type NativePushToken = {
  value: string;
  platform: "android" | "ios";
};

export type NativePushPermission = "granted" | "denied" | "prompt";

let lastToken: string | null = null;
let listenersReady = false;

export function getLastNativePushToken(): string | null {
  return lastToken;
}

function currentPlatform(): "android" | "ios" {
  return nativePlatform() === "ios" ? "ios" : "android";
}

function emitToken(value: string): NativePushToken {
  lastToken = value;
  const token: NativePushToken = { value, platform: currentPlatform() };
  try {
    window.dispatchEvent(new CustomEvent(NATIVE_FCM_TOKEN_EVENT, { detail: token }));
  } catch {
    /* ignore */
  }
  return token;
}

/** True unless the user turned native push off in settings. Default: on. */
export function isNativePushOptedIn(): boolean {
  try {
    return localStorage.getItem(NATIVE_PUSH_OPT_OUT_KEY) !== "1";
  } catch {
    return true;
  }
}

export function setNativePushOptIn(on: boolean): void {
  try {
    if (on) {
      localStorage.setItem(NATIVE_PUSH_OPT_IN_KEY, "1");
      localStorage.removeItem(NATIVE_PUSH_OPT_OUT_KEY);
    } else {
      localStorage.setItem(NATIVE_PUSH_OPT_OUT_KEY, "1");
      localStorage.removeItem(NATIVE_PUSH_OPT_IN_KEY);
    }
  } catch {
    /* ignore */
  }
}

export async function getNativePushPermission(): Promise<NativePushPermission> {
  if (!isNativeApp()) return "denied";
  try {
    const perm = await PushNotifications.checkPermissions();
    if (perm.receive === "granted") return "granted";
    if (perm.receive === "denied") return "denied";
    return "prompt";
  } catch {
    return "denied";
  }
}

async function ensureListeners(): Promise<void> {
  if (listenersReady) return;
  listenersReady = true;
  await PushNotifications.removeAllListeners();

  await PushNotifications.addListener("registration", (token) => {
    emitToken(token.value);
  });
  await PushNotifications.addListener("registrationError", (err) => {
    console.warn("[native-push] registration error", err);
  });
  await PushNotifications.addListener("pushNotificationReceived", (notification) => {
    const title = notification.title || "מערכת ניהול עובדים";
    const body = notification.body || "";
    const data = (notification.data ?? {}) as { url?: string; tone?: string };
    playAlertTone(resolveAlertTone(data.tone));
    try {
      navigator.vibrate?.([400, 120, 400, 120, 600]);
    } catch {
      /* ignore */
    }
    window.dispatchEvent(
      new CustomEvent("tc:foreground-push", { detail: { title, body, url: data.url } }),
    );
  });
  await PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
    const url = (action.notification.data as { url?: string } | undefined)?.url;
    if (url && typeof window !== "undefined") {
      window.location.assign(url);
    }
  });
}

/** Request permission + register for FCM. Resolves with the device token when possible. */
export async function initNativePush(): Promise<NativePushToken | null> {
  if (!isNativeApp()) return null;
  if (!isNativePushOptedIn()) return null;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.warn("[native-push] permission not granted", perm.receive);
      return null;
    }

    await ensureListeners();

    const tokenPromise = new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const onToken = (event: Event) => {
        const value = (event as CustomEvent<NativePushToken>).detail?.value;
        if (value) finish(value);
      };
      window.addEventListener(NATIVE_FCM_TOKEN_EVENT, onToken);
      window.setTimeout(() => {
        window.removeEventListener(NATIVE_FCM_TOKEN_EVENT, onToken);
        finish(lastToken);
      }, 8000);
    });

    await PushNotifications.register();
    const value = await tokenPromise;
    if (!value) return lastToken ? { value: lastToken, platform: currentPlatform() } : null;
    return { value, platform: currentPlatform() };
  } catch (err) {
    console.warn("[native-push] init failed", err);
    return null;
  }
}
