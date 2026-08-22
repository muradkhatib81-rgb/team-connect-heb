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
    // Unique tag each time so OS re-alerts (sound/vibrate) instead of silently replacing.
    tag:
      input.tag ??
      (input.messageId
        ? `message-${input.messageId}-${Date.now()}`
        : input.scheduleId
          ? `schedule-${input.scheduleId}-${Date.now()}`
          : `notif-${Date.now()}`),
    silent: false,
  };

  return dispatchWebPushToUsers(userIds, payload);
}

/** Fire-and-forget push from app server code. Never throws. */
export async function dispatchPushBestEffort(input: PushDispatchInput): Promise<void> {
  try {
    const result = await dispatchPushNotification(input);
    if (result.sent === 0 && result.failed === 0) {
      console.warn("[push] dispatch skipped (no subs or VAPID missing)", {
        recipients: input.userIds.length,
      });
    }
  } catch (e) {
    console.warn("[push] app dispatch failed:", e);
  }
}

export async function pushForScheduleNotification(opts: {
  userIds: string[];
  message: string;
  scheduleId?: string | null;
  weekStart?: string | null;
}): Promise<void> {
  const userIds = [...new Set(opts.userIds.filter(Boolean))];
  if (!userIds.length || !opts.message.trim()) return;
  await dispatchPushBestEffort({
    userIds,
    message: opts.message,
    scheduleId: opts.scheduleId ?? null,
    weekStart: opts.weekStart ?? null,
    // New tag every send so updates re-notify with sound.
    tag: opts.scheduleId
      ? `schedule-${opts.scheduleId}-${Date.now()}`
      : `schedule-${Date.now()}`,
  });
}

/**
 * Insert in-app notification rows (bypassing RLS) and always send Web Push.
 * Never throws — callers (save/publish/tasks) must not fail because of notify.
 */
export async function notifyUsersWithPush(opts: {
  userIds: string[];
  message: string;
  scheduleId?: string | null;
  weekStart?: string | null;
  branchId?: string | null;
  title?: string;
  tag?: string;
  url?: string;
  messageId?: string;
}): Promise<void> {
  try {
    const userIds = [...new Set(opts.userIds.filter(Boolean))];
    const message = opts.message.trim();
    if (!userIds.length || !message) return;

    let branchId = opts.branchId ?? null;
    let weekStart = opts.weekStart ?? null;
    if (opts.scheduleId && (!branchId || !weekStart)) {
      const { data } = await supabaseAdmin
        .from("schedules")
        .select("branch_id, week_start")
        .eq("id", opts.scheduleId)
        .maybeSingle();
      const row = data as { branch_id?: string | null; week_start?: string | null } | null;
      branchId = branchId ?? row?.branch_id ?? null;
      weekStart = weekStart ?? row?.week_start?.slice(0, 10) ?? null;
    }

    const { error: insertErr } = await supabaseAdmin.from("schedule_notifications").insert(
      userIds.map((uid) => ({
        user_id: uid,
        message,
        schedule_id: opts.scheduleId ?? null,
        ...(branchId ? { branch_id: branchId } : {}),
      })),
    );
    if (insertErr) {
      console.warn("[notify] schedule_notifications insert failed:", insertErr.message);
    }

    // Push even if insert failed — employees must still get the OS alert.
    await dispatchPushBestEffort({
      userIds,
      message,
      scheduleId: opts.scheduleId ?? null,
      weekStart,
      title: opts.title,
      tag: opts.tag,
      url: opts.url,
      messageId: opts.messageId,
    });
  } catch (e) {
    console.warn("[notify] notifyUsersWithPush failed:", e);
  }
}

/** Notify every active profile in the branch except the actor. Never throws. */
export async function notifyBranchExceptActor(opts: {
  branchId: string;
  excludeUserId: string;
  message: string;
  tag?: string;
  url?: string;
  /** Default true. Set false when a DB trigger already inserted in-app rows. */
  insertInApp?: boolean;
}): Promise<number> {
  try {
    const message = opts.message.trim();
    if (!message || !opts.branchId) return 0;

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("branch_id", opts.branchId)
      .neq("id", opts.excludeUserId)
      .eq("is_active", true);

    const userIds = (profiles ?? []).map((p: { id: string }) => p.id);
    if (!userIds.length) return 0;

    const url = opts.url ?? "/dashboard";
    if (opts.insertInApp === false) {
      await dispatchPushBestEffort({
        userIds,
        message,
        tag: opts.tag,
        url,
      });
    } else {
      await notifyUsersWithPush({
        userIds,
        message,
        branchId: opts.branchId,
        tag: opts.tag,
        url,
      });
    }
    return userIds.length;
  } catch (e) {
    console.warn("[notify] notifyBranchExceptActor failed:", e);
    return 0;
  }
}
