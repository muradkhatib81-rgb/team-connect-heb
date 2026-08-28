import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notificationPushUrl } from "@/lib/notification-navigation";
import {
  filterUserIdsForPushScope,
  isPlatformPushEventEnabled,
  isPlatformPushScopeAllowed,
} from "@/lib/platform-push-settings.functions";
import { dispatchFcmToUsers } from "@/lib/fcm.server";
import { dispatchWebPushToUsers, type WebPushPayload } from "@/lib/web-push.server";
import i18n from "@/i18n";

export type PushDispatchInput = {
  userIds: string[];
  message: string;
  scheduleId?: string | null;
  weekStart?: string | null;
  branchId?: string | null;
  title?: string;
  url?: string;
  messageId?: string;
  tag?: string;
  /** Platform-owner toggle key. When set and disabled → skip Web Push only. */
  eventKey?: string | null;
  tone?: "break_start" | "break_end" | "break_late" | "default" | null;
  /** Actor who triggered the event — never receive in-app or push. */
  excludeUserId?: string | null;
  /** Extra endpoints to skip (e.g. the actor's current Chrome/APK device). */
  skipPushEndpoints?: string[] | null;
};

function freshPushTag(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

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

function sameUserId(a?: string | null, b?: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

async function endpointsForUser(userId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("push_subscriptions")
    .select("endpoint")
    .eq("user_id", userId);
  return ((data ?? []) as { endpoint?: string | null }[])
    .map((row) => row.endpoint)
    .filter((endpoint): endpoint is string => !!endpoint);
}

/** Break start / end / late: push only the break holder — never fan out. */
const HOLDER_ONLY_BREAK_KEYS = new Set(["break_start", "break_end", "break_late"]);

function isHolderOnlyBreakPush(
  eventKey?: string | null,
  tone?: string | null,
): boolean {
  return (
    HOLDER_ONLY_BREAK_KEYS.has(eventKey ?? "") ||
    HOLDER_ONLY_BREAK_KEYS.has(tone ?? "")
  );
}

/** Unified push dispatch for any in-app / realtime notification event. */
export async function dispatchPushNotification(
  input: PushDispatchInput,
): Promise<{ sent: number; failed: number }> {
  const actorId = input.excludeUserId?.trim() || null;
  let userIds = [
    ...new Set(input.userIds.filter((id) => id && !sameUserId(id, actorId))),
  ];
  // Hard cap: break lifecycle alerts go to exactly one person (the holder).
  if (isHolderOnlyBreakPush(input.eventKey, input.tone) && userIds.length > 1) {
    console.warn("[push] break lifecycle fan-out blocked; keeping first recipient only", {
      eventKey: input.eventKey ?? null,
      tone: input.tone ?? null,
      dropped: userIds.length - 1,
    });
    userIds = userIds.slice(0, 1);
  }
  const body = input.message.trim();
  if (!userIds.length || !body) return { sent: 0, failed: 0 };

  if (input.eventKey) {
    if (!(await isPlatformPushEventEnabled(input.eventKey))) {
      return { sent: 0, failed: 0 };
    }
    if (input.branchId) {
      if (!(await isPlatformPushScopeAllowed(input.branchId))) {
        return { sent: 0, failed: 0 };
      }
    } else {
      userIds = await filterUserIdsForPushScope(userIds);
      if (!userIds.length) return { sent: 0, failed: 0 };
    }
  }

  const weekStart = await resolveWeekStart(input.scheduleId, input.weekStart);
  const url =
    input.url ??
    (input.messageId
      ? "/communications"
      : notificationPushUrl(body, { scheduleId: input.scheduleId, weekStart }));

  const payload: WebPushPayload = {
    title: input.title ?? i18n.t("common.appName"),
    body,
    url,
    tag:
      input.tag?.trim() ||
      freshPushTag(
        input.scheduleId ? `schedule-${input.scheduleId}` : input.messageId ? "message" : "notif",
      ),
    silent: false,
    tone:
      input.tone ??
      (input.eventKey === "break_start" ||
      input.eventKey === "break_end" ||
      input.eventKey === "break_late"
        ? input.eventKey
        : null),
  };

  const skipEndpoints = [
    ...(actorId ? await endpointsForUser(actorId) : []),
    ...(input.skipPushEndpoints ?? []).filter(Boolean),
  ];
  const skipOpts = skipEndpoints.length ? { skipEndpoints } : undefined;
  const [web, fcm] = await Promise.all([
    dispatchWebPushToUsers(userIds, payload, skipOpts),
    dispatchFcmToUsers(userIds, payload, skipOpts),
  ]);
  return { sent: web.sent + fcm.sent, failed: web.failed + fcm.failed };
}

/** Best-effort push — never throws. Awaits completion so serverless does not kill the send. */
export async function dispatchPushBestEffort(input: PushDispatchInput): Promise<void> {
  try {
    const result = await dispatchPushNotification(input);
    if (result.sent === 0 && result.failed === 0) {
      console.warn("[push] dispatch skipped (no subs, VAPID missing, or event disabled)", {
        recipients: input.userIds.length,
        eventKey: input.eventKey ?? null,
      });
    } else if (result.sent === 0 && result.failed > 0) {
      console.warn("[push] all endpoints failed", {
        recipients: input.userIds.length,
        failed: result.failed,
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
  eventKey?: string | null;
}): Promise<void> {
  const userIds = [...new Set(opts.userIds.filter(Boolean))];
  if (!userIds.length || !opts.message.trim()) return;
  await dispatchPushBestEffort({
    userIds,
    message: opts.message,
    scheduleId: opts.scheduleId ?? null,
    weekStart: opts.weekStart ?? null,
    title: i18n.t("libErrors.schedules.pushTitle"),
    tag: freshPushTag(opts.scheduleId ? `schedule-${opts.scheduleId}` : "schedule"),
    eventKey: opts.eventKey ?? "schedule_update",
  });
}

/**
 * Always inserts silent in-app bell rows; Web Push only when platform owner
 * enabled the event (or eventKey omitted → push on).
 * Never throws — callers must stay responsive.
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
  eventKey?: string | null;
  /** When false, skip Web Push (silent bell only). */
  sendPush?: boolean;
  /** Actor who triggered the event — never receive in-app or push. */
  excludeUserId?: string | null;
  skipPushEndpoints?: string[] | null;
}): Promise<void> {
  try {
    const actorId = opts.excludeUserId?.trim() || null;
    const userIds = [
      ...new Set(opts.userIds.filter((id) => id && !sameUserId(id, actorId))),
    ];
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

    const tag =
      opts.tag?.trim() ||
      freshPushTag(
        opts.scheduleId ? `schedule-${opts.scheduleId}` : opts.messageId ? "message" : "notif",
      );

    // 1) Silent in-app bell first — always, regardless of push toggles.
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

    // 2) Web Push only when allowed.
    if (opts.sendPush === false) return;
    await dispatchPushBestEffort({
      userIds,
      message,
      scheduleId: opts.scheduleId ?? null,
      weekStart,
      branchId,
      title: opts.title,
      tag,
      url: opts.url,
      messageId: opts.messageId,
      eventKey: opts.eventKey,
      excludeUserId: actorId,
      skipPushEndpoints: opts.skipPushEndpoints,
    });
  } catch (e) {
    console.warn("[notify] notifyUsersWithPush failed:", e);
  }
}

/**
 * Notify every active profile in the branch except the actor.
 * @param insertInApp false = Web Push only (when a DB trigger already wrote in-app rows).
 * @param sendPush false = silent in-app bell only (no Web Push).
 * Never throws.
 */
export async function notifyBranchExceptActor(opts: {
  branchId: string;
  excludeUserId: string;
  message: string;
  tag?: string;
  url?: string;
  insertInApp?: boolean;
  sendPush?: boolean;
  eventKey?: string | null;
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
    const tag = opts.tag?.trim() || freshPushTag("branch");
    const sendPush = opts.sendPush !== false;
    const insertInApp = opts.insertInApp !== false;

    if (!sendPush) {
      if (!insertInApp) return 0;
      const { error: insertErr } = await supabaseAdmin.from("schedule_notifications").insert(
        userIds.map((uid) => ({
          user_id: uid,
          message,
          schedule_id: null,
          branch_id: opts.branchId,
        })),
      );
      if (insertErr) {
        console.warn("[notify] in-app-only insert failed:", insertErr.message);
      }
      return userIds.length;
    }

    if (!insertInApp) {
      await dispatchPushBestEffort({
        userIds,
        message,
        tag,
        url,
        branchId: opts.branchId,
        eventKey: opts.eventKey,
      });
    } else {
      await notifyUsersWithPush({
        userIds,
        message,
        branchId: opts.branchId,
        tag,
        url,
        eventKey: opts.eventKey,
      });
    }
    return userIds.length;
  } catch (e) {
    console.warn("[notify] notifyBranchExceptActor failed:", e);
    return 0;
  }
}
