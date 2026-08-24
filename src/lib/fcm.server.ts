import { createSign } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FCM_KEY_MARKER, isFcmEndpoint, tokenFromFcmEndpoint } from "@/lib/fcm-endpoints";
import type { WebPushPayload } from "@/lib/web-push.server";

type ServiceAccount = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
};

type CachedToken = { value: string; exp: number };

let cachedAccess: CachedToken | null = null;

function readServiceAccount(): ServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ServiceAccount;
  } catch {
    console.warn("[fcm] FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON");
    return null;
  }
}

function base64UrlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  if (!sa.client_email || !sa.private_key) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess && cachedAccess.exp - 60 > now) return cachedAccess.value;

  const unsigned = `${base64UrlJson({ alg: "RS256", typ: "JWT" })}.${base64UrlJson({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const jwt = `${unsigned}.${signer.sign(sa.private_key.replace(/\\n/g, "\n"), "base64url")}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !json.access_token) {
    console.warn("[fcm] oauth token failed", res.status);
    return null;
  }
  cachedAccess = {
    value: json.access_token,
    exp: now + (json.expires_in ?? 3600),
  };
  return cachedAccess.value;
}

function channelForTone(tone: WebPushPayload["tone"]): string {
  if (tone === "break_start") return "break_start";
  if (tone === "break_end") return "break_end";
  if (tone === "break_late") return "break_late";
  return "general";
}

export async function dispatchFcmToUsers(
  userIds: string[],
  payload: WebPushPayload,
  options?: { skipEndpoints?: string[] },
): Promise<{ sent: number; failed: number }> {
  const sa = readServiceAccount();
  if (!sa) return { sent: 0, failed: 0 };

  const projectId =
    sa.project_id?.trim() || process.env.FIREBASE_PROJECT_ID?.trim() || "";
  if (!projectId) return { sent: 0, failed: 0 };

  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (!uniqueIds.length) return { sent: 0, failed: 0 };

  const { data: subs, error } = await (supabaseAdmin as any)
    .from("push_subscriptions")
    .select("id, endpoint, p256dh")
    .in("user_id", uniqueIds)
    .eq("p256dh", FCM_KEY_MARKER);

  if (error || !subs?.length) return { sent: 0, failed: 0 };

  const skipEndpoints = new Set((options?.skipEndpoints ?? []).filter(Boolean));
  const deliverable = skipEndpoints.size
    ? (subs as { id: string; endpoint: string; p256dh: string }[]).filter(
        (s) => !skipEndpoints.has(s.endpoint),
      )
    : (subs as { id: string; endpoint: string; p256dh: string }[]);
  if (!deliverable.length) return { sent: 0, failed: 0 };

  const access = await getAccessToken(sa);
  if (!access) return { sent: 0, failed: (subs as { id: string }[]).length };

  const channel = channelForTone(payload.tone);
  let sent = 0;
  let failed = 0;
  const staleIds: string[] = [];

  await Promise.allSettled(
    deliverable.map(async (sub) => {
      if (!isFcmEndpoint(sub.endpoint)) {
        failed++;
        return;
      }
      const token = tokenFromFcmEndpoint(sub.endpoint);
      if (!token) {
        failed++;
        return;
      }
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${access}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: payload.title,
                body: payload.body,
              },
              data: {
                url: payload.url ?? "/dashboard",
                tag: payload.tag ?? "",
              },
              android: {
                priority: "HIGH",
                notification: {
                  channel_id: channel,
                  notification_count: 1,
                },
              },
            },
          }),
        },
      );
      if (res.ok) {
        sent++;
        return;
      }
      failed++;
      if (res.status === 404 || res.status === 410) staleIds.push(sub.id);
      else console.warn("[fcm] send failed", res.status, await res.text().catch(() => ""));
    }),
  );

  if (staleIds.length) {
    await (supabaseAdmin as any).from("push_subscriptions").delete().in("id", staleIds);
  }

  return { sent, failed };
}
