import webpush from "web-push";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type WebPushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  /** When true, OS may suppress sound — always false for user-facing alerts. */
  silent?: boolean;
  /** Distinctive alert tone for break lifecycle (played in open tabs + vibrate pattern). */
  tone?: "break_start" | "break_end" | "break_late" | "default" | null;
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

  const tone = payload.tone ?? null;
  const vibrate =
    tone === "break_start"
      ? [500, 100, 500, 100, 700, 120, 900]
      : tone === "break_end"
        ? [700, 80, 700, 80, 700, 80, 1000]
        : tone === "break_late"
          ? [300, 60, 300, 60, 300, 60, 300, 60, 800]
          : [400, 120, 400, 120, 600];

  const sound =
    tone === "break_start"
      ? "/sounds/break-start.wav"
      : tone === "break_end"
        ? "/sounds/break-end.wav"
        : tone === "break_late"
          ? "/sounds/break-late.wav"
          : undefined;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/dashboard",
    // Hint only — SW forces a fresh unique tag + silent:false.
    tag: payload.tag ?? `notif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    silent: false,
    vibrate,
    tone,
    sound,
    renotify: true,
    requireInteraction: true,
  });

  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  const sendOne = async (sub: PushSubscriptionRow) => {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      body,
      { TTL: 86_400, urgency: "high" },
    );
  };

  await Promise.allSettled(
    (subs as PushSubscriptionRow[]).map(async (sub) => {
      try {
        await sendOne(sub);
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
