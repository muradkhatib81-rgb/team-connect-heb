import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notificationPushUrl } from "@/lib/notification-navigation";
import { dispatchWebPushToUsers, type WebPushPayload } from "@/lib/web-push.server";

export type PushDispatchInput = {
  userIds: string[];
  message: string;
  scheduleId?: string | null;
  weekStart?: string | null;
  title?: string;
  url?: string;
  messageId?: string;
  tag?: string;
};

async function resolveWeekStart(
  scheduleId?: string | null,
  weekStart?: string | null,
): Promise<string | null> {
  if (weekStart?.trim()) return weekStart.slice(0, 10);
  if (!scheduleId) return null;
  const { data } = await supabaseAdmin
    .from("schedules")
    .select("week_start")
    .eq("id", scheduleId)
    .maybeSingle();
  return (data as { week_start?: string } | null)?.week_start?.slice(0, 10) ?? null;
}

/** Unified push dispatch for any in-app / realtime notification event. */
export async function dispatchPushNotification(
  input: PushDispatchInput,
): Promise<{ sent: number; failed: number }> {
  const userIds = [...new Set(input.userIds.filter(Boolean))];
  const body = input.message.trim();
  if (!userIds.length || !body) return { sent: 0, failed: 0 };

  const weekStart = await resolveWeekStart(input.scheduleId, input.weekStart);
  const url =
    input.url ??
    (input.messageId
      ? "/communications"
      : notificationPushUrl(body, { scheduleId: input.scheduleId, weekStart }));

  const payload: WebPushPayload = {
    title: input.title ?? "מערכת ניהול עובדים",
    body,
    url,
    tag:
      input.tag ??
      (input.messageId
        ? `message-${input.messageId}`
        : input.scheduleId
          ? `schedule-${input.scheduleId}`
          : `notif-${Date.now()}`),
  };

  return dispatchWebPushToUsers(userIds, payload);
}
