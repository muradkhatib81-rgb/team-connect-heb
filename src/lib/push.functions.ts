import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { FCM_KEY_MARKER, fcmEndpointForToken } from "@/lib/fcm-endpoints";
import { dispatchPushNotification } from "@/lib/push-dispatch.server";
import { getVapidPublicKey } from "@/lib/web-push.server";

export type PushTestResult =
  | { ok: true; sent: number; failed: number }
  | {
      ok: false;
      reason: "no_vapid" | "no_subscription" | "push_failed" | "db_error" | "server_error";
      detail?: string;
    };

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});

async function upsertPushSubscription(
  userId: string,
  data: z.infer<typeof subscriptionSchema>,
): Promise<void> {
  const now = new Date().toISOString();
  // One physical device/browser must belong to the signed-in user only.
  // Leftover rows from a previous login on the same Chrome profile would
  // otherwise still receive pushes meant for that other account.
  await (supabaseAdmin as any)
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", data.endpoint)
    .neq("user_id", userId);
  const { error } = await (supabaseAdmin as any).from("push_subscriptions").upsert(
    {
      user_id: userId,
      endpoint: data.endpoint,
      p256dh: data.keys.p256dh,
      auth: data.keys.auth,
      user_agent: data.userAgent ?? null,
      updated_at: now,
    },
    { onConflict: "user_id,endpoint" },
  );
  if (error) throw new Error(error.message);
}

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => subscriptionSchema.parse(d))
  .handler(async ({ data, context }) => {
    await upsertPushSubscription(context.userId, data);
    return { ok: true };
  });

export const saveFcmToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        token: z.string().min(8).max(4096),
        platform: z.enum(["android", "ios"]).default("android"),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    await upsertPushSubscription(context.userId, {
      endpoint: fcmEndpointForToken(data.token),
      keys: { p256dh: FCM_KEY_MARKER, auth: data.platform },
      userAgent: `native-${data.platform}`,
    });
    return { ok: true as const };
  });

export const removeFcmToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await (context.supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("p256dh", FCM_KEY_MARKER);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ endpoint: z.string().url() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await (context.supabase as any)
      .from("push_subscriptions")
      .delete()
      .eq("user_id", context.userId)
      .eq("endpoint", data.endpoint);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** App-side push for a sent message (backup when DB trigger / pg_net fails). */
export const dispatchMessagePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ messageId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: msg, error: msgErr } = await supabaseAdmin
      .from("messages")
      .select("id, title, body, sender_id")
      .eq("id", data.messageId)
      .is("deleted_at", null)
      .maybeSingle();
    if (msgErr) throw new Error(msgErr.message);
    if (!msg || msg.sender_id !== context.userId) {
      return { ok: false, sent: 0, failed: 0 };
    }

    const { data: recips, error: recErr } = await supabaseAdmin
      .from("message_recipients")
      .select("user_id")
      .eq("message_id", data.messageId);
    if (recErr) throw new Error(recErr.message);

    const userIds = (recips ?? []).map((r) => r.user_id);
    const result = await dispatchPushNotification({
      userIds,
      title: msg.title,
      message: (msg.body?.trim() || msg.title).slice(0, 240),
      messageId: data.messageId,
      url: "/communications",
      eventKey: "messages",
    });
    return { ok: true, ...result };
  });

/** Send a test push to the current user's device. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ subscription: subscriptionSchema.optional() }).parse(d ?? {}),
  )
  .handler(async ({ data, context }): Promise<PushTestResult> => {
    try {
      if (data.subscription) {
        try {
          await upsertPushSubscription(context.userId, data.subscription);
        } catch (e) {
          const detail = (e as Error)?.message ?? "save failed";
          console.warn("[push] test subscription save failed:", detail);
          return { ok: false, reason: "db_error", detail };
        }
      }

      const { data: subs, error: subErr } = await supabaseAdmin
        .from("push_subscriptions")
        .select("id, p256dh")
        .eq("user_id", context.userId)
        .limit(5);
      if (subErr) {
        console.warn("[push] test subscription lookup failed:", subErr.message);
        return { ok: false, reason: "db_error", detail: subErr.message };
      }
      if (!subs?.length) {
        return { ok: false, reason: "no_subscription" };
      }

      const hasFcm = (subs as { p256dh: string }[]).some((s) => s.p256dh === FCM_KEY_MARKER);
      if (!hasFcm && !getVapidPublicKey()) {
        return { ok: false, reason: "no_vapid" };
      }

      const result = await dispatchPushNotification({
        userIds: [context.userId],
        title: "בדיקת התראות",
        message: "ההתראות פועלות כראוי ✓",
        url: "/profile",
        tag: `push-test-${Date.now()}`,
      });

      if (result.sent > 0) return { ok: true, ...result };
      if (result.failed > 0) return { ok: false, reason: "push_failed" };
      return { ok: false, reason: "no_subscription" };
    } catch (e) {
      const detail = (e as Error)?.message ?? "unknown";
      console.warn("[push] sendTestPush failed:", detail);
      return { ok: false, reason: "server_error", detail };
    }
  });
