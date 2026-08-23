/**
 * Native push (Capacitor + FCM on Android).
 */
import { PushNotifications } from "@capacitor/push-notifications";
import { isNativeApp } from "@/lib/native-app";
import { NATIVE_PUSH_OPT_IN_KEY } from "@/lib/fcm-endpoints";

export type NativePushToken = {
  value: string;
  platform: "android" | "ios";
};

export type NativePushPermission = "granted" | "denied" | "prompt";

let lastToken: string | null = null;

export function getLastNativePushToken(): string | null {
  return lastToken;
}

export function isNativePushOptedIn(): boolean {
  try {
    return localStorage.getItem(NATIVE_PUSH_OPT_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function setNativePushOptIn(on: boolean): void {
  try {
    if (on) localStorage.setItem(NATIVE_PUSH_OPT_IN_KEY, "1");
    else localStorage.removeItem(NATIVE_PUSH_OPT_IN_KEY);
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

/** Request permission + register for FCM. Resolves with the device token when possible. */
export async function initNativePush(): Promise<NativePushToken | null> {
  if (!isNativeApp()) return null;

  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== "granted") {
      console.warn("[native-push] permission not granted", perm.receive);
      return null;
    }

    await PushNotifications.removeAllListeners();

    const tokenPromise = new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      void PushNotifications.addListener("registration", (token) => {
        lastToken = token.value;
        finish(token.value);
      });
      void PushNotifications.addListener("registrationError", (err) => {
        console.warn("[native-push] registration error", err);
        finish(null);
      });
      window.setTimeout(() => finish(lastToken), 8000);
    });

    void PushNotifications.addListener("pushNotificationReceived", (notification) => {
      console.info("[native-push] received (foreground)", notification.title);
    });

    void PushNotifications.addListener("pushNotificationActionPerformed", (action) => {
      const url = (action.notification.data as { url?: string } | undefined)?.url;
      if (url && typeof window !== "undefined") {
        window.location.assign(url);
      }
    });

    await PushNotifications.register();
    const value = await tokenPromise;
    if (!value) return null;
    const platform = /iphone|ipad|ios/i.test(navigator.userAgent) ? "ios" : "android";
    return { value, platform };
  } catch (err) {
    console.warn("[native-push] init failed", err);
    return null;
  }
}
