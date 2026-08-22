import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { dispatchPushNotification } from "@/lib/push-dispatch.server";

const subscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().max(500).optional(),
});

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => subscriptionSchema.parse(d))
  .handler(async ({ data, context }) => {
    const now = new Date().toISOString();
    const { error } = await (context.supabase as any).from("push_subscriptions").upsert(
      {
        user_id: context.userId,
        endpoint: data.endpoint,
        p256dh: data.keys.p256dh,
        auth: data.keys.auth,
        user_agent: data.userAgent ?? null,
        updated_at: now,
      },
      { onConflict: "user_id,endpoint" },
    );
    if (error) throw new Error(error.message);
    return { ok: true };
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
    });
    return { ok: true, ...result };
  });

/** Send a test push to the current user's device. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const result = await dispatchPushNotification({
      userIds: [context.userId],
      title: "בדיקת התראות",
      message: "ההתראות פועלות כראוי ✓",
      url: "/profile",
      tag: "push-test",
    });
    if (result.sent === 0 && result.failed === 0) {
      throw new Error("no_subscription");
    }
    return { ok: true, ...result };
  });
