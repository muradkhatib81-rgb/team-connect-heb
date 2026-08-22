import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

let vapidConfigured = false;

function readVapidPublicKey(): string | undefined {
  return (
    process.env.VAPID_PUBLIC_KEY?.trim() ||
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim() ||
    undefined
  );
}

function readVapidPrivateKey(): string | undefined {
  return process.env.VAPID_PRIVATE_KEY?.trim() || undefined;
}

/** VAPID subject must be mailto:… or a URL with scheme (https://…). */
function normalizeVapidSubject(raw: string | undefined): string {
  const fallback = "mailto:support@team-connect.local";
  const value = raw?.trim();
  if (!value) return fallback;
  if (/^mailto:/i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  // Bare domain like team-connect-heb.vercel.app
  if (/^[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) return `https://${value.replace(/\/+$/, "")}`;
  return fallback;
}

function readVapidSubject(): string {
  return normalizeVapidSubject(
    process.env.VAPID_SUBJECT?.trim() ||
      process.env.VITE_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_URL?.trim(),
  );
}

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = readVapidPublicKey();
  const privateKey = readVapidPrivateKey();
  if (!publicKey || !privateKey) return false;
  try {
    webpush.setVapidDetails(readVapidSubject(), publicKey, privateKey);
    vapidConfigured = true;
    return true;
  } catch (e) {
    console.warn("[push] VAPID configuration failed:", e);
    return false;
  }
}

export function getVapidPublicKey(): string | null {
  return readVapidPublicKey() || null;
}

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Send Web Push to all subscriptions for the given user ids. Best-effort; never throws. */
export async function dispatchWebPushToUsers(
  userIds: string[],
  payload: WebPushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!ensureVapidConfigured()) return { sent: 0, failed: 0 };

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return { sent: 0, failed: 0 };

  const { data: subs, error } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", uniqueIds);

  if (error || !subs?.length) return { sent: 0, failed: 0 };

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    tag: payload.tag ?? `notif-${Date.now()}`,
  });

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    (subs as PushSubscriptionRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          body,
          { TTL: 86_400, urgency: "high" },
        );
        sent++;
      } catch (err: unknown) {
        failed++;
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) staleIds.push(sub.id);
      }
    }),
  );

  if (staleIds.length) {
    await (supabaseAdmin as any).from("push_subscriptions").delete().in("id", staleIds);
  }

  return { sent, failed };
}
