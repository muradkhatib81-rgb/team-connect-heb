import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

let vapidConfigured = false;

function ensureVapidConfigured(): boolean {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  const subject =
    process.env.VAPID_SUBJECT?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    "mailto:support@team-connect.local";
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
}

export function getVapidPublicKey(): string | null {
  const key = process.env.VAPID_PUBLIC_KEY?.trim();
  return key || null;
}

/** Infer in-app navigation target from notification copy. */
export function pushUrlFromMessage(message: string, scheduleId?: string | null): string {
  if (scheduleId) return "/schedules";
  const m = message.trim();
  if (/משימה|task/i.test(m)) return "/tasks";
  if (/הודעה|message|תקשורת/i.test(m)) return "/communications";
  if (/סידור|schedule|לוח/i.test(m)) return "/schedules";
  return "/dashboard";
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

/** Fire-and-forget wrapper for in-app notification inserts. */
export function dispatchWebPushForInAppNotification(
  userIds: string[],
  message: string,
  opts?: { scheduleId?: string | null; title?: string },
): void {
  const body = message.trim();
  if (!body) return;
  const url = pushUrlFromMessage(body, opts?.scheduleId);
  void dispatchWebPushToUsers(userIds, {
    title: opts?.title ?? "מערכת ניהול עובדים",
    body,
    url,
    tag: opts?.scheduleId ? `schedule-${opts.scheduleId}` : `inapp-${Date.now()}`,
  }).catch((e) => console.warn("[push] dispatch failed", e));
}
