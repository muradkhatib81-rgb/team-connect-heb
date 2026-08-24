import { fcmEndpointForToken } from "@/lib/fcm-endpoints";
import { isNativeApp } from "@/lib/native-app";
import { getLastNativePushToken } from "@/lib/native-push";

/** Push endpoint of THIS device (Chrome Web Push or native FCM). */
export async function getCurrentPushEndpoint(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (isNativeApp()) {
    const token = getLastNativePushToken();
    return token ? fcmEndpointForToken(token) : null;
  }
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const sub = await reg.pushManager.getSubscription();
      if (sub?.endpoint) return sub.endpoint;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function getCurrentWebPushSubscription(): Promise<{
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
} | null> {
  if (typeof window === "undefined") return null;
  if (isNativeApp()) return null;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const reg of regs) {
      const sub = await reg.pushManager.getSubscription();
      const json = sub?.toJSON();
      if (json?.endpoint && json.keys?.p256dh && json.keys?.auth) {
        return {
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
          userAgent: navigator.userAgent.slice(0, 500),
        };
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}
