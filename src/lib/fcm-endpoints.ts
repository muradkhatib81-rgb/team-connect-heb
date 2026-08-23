/** Marker used in push_subscriptions.p256dh for native FCM device tokens. */
export const FCM_KEY_MARKER = "fcm";

const FCM_ENDPOINT_PREFIX = "https://fcm.googleapis.com/fcm/token/";

export function fcmEndpointForToken(token: string): string {
  return `${FCM_ENDPOINT_PREFIX}${encodeURIComponent(token)}`;
}

export function isFcmEndpoint(endpoint: string): boolean {
  return endpoint.startsWith(FCM_ENDPOINT_PREFIX);
}

export function tokenFromFcmEndpoint(endpoint: string): string | null {
  if (!isFcmEndpoint(endpoint)) return null;
  try {
    return decodeURIComponent(endpoint.slice(FCM_ENDPOINT_PREFIX.length));
  } catch {
    return null;
  }
}

export const NATIVE_PUSH_OPT_IN_KEY = "native-push-opt-in";
