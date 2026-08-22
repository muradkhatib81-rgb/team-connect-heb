import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dispatchWebPushToUsers } from "@/lib/web-push.server";

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

const messagePushSchema = z.object({
  recipientIds: z.array(z.string().uuid()).min(1),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(500),
  messageId: z.string().uuid(),
});

/** Called after a message is sent so recipients get a system push. */
export const dispatchMessagePush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => messagePushSchema.parse(d))
  .handler(async ({ data, context }) => {
    const recipients = data.recipientIds.filter((id) => id !== context.userId);
    if (!recipients.length) return { sent: 0 };
    return dispatchWebPushToUsers(recipients, {
      title: data.title,
      body: data.body,
      url: "/communications",
      tag: `message-${data.messageId}`,
    });
  });
