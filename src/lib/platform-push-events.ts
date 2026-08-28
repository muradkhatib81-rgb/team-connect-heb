import i18n from "@/i18n";
/** Platform-owner Web Push event catalog. Silent in-app bell is always on. */

export const PLATFORM_PUSH_EVENT_DEFS = [
  { key: "schedule_update", group: "schedule" },
  { key: "schedule_publish", group: "schedule" },
  { key: "schedule_approve", group: "schedule" },
  { key: "schedule_reject", group: "schedule" },
  { key: "leave_request", group: "leave" },
  { key: "leave_decision", group: "leave" },
  { key: "leave_cancel", group: "leave" },
  { key: "break_start", group: "break" },
  { key: "break_end", group: "break" },
  { key: "break_late", group: "break" },
  { key: "break_approval", group: "break" },
  { key: "custody_take", group: "custody" },
  { key: "custody_return", group: "custody" },
  { key: "management_on_shift", group: "ops" },
  { key: "tasks", group: "ops" },
  { key: "messages", group: "ops" },
  { key: "control_log", group: "ops" },
] as const;

export type PlatformPushEventKey = (typeof PLATFORM_PUSH_EVENT_DEFS)[number]["key"];

const PLATFORM_PUSH_EVENT_I18N: Record<PlatformPushEventKey, string> = {
  schedule_update: "platformPushEvents.schedule_update",
  schedule_publish: "platformPushEvents.schedule_publish",
  schedule_approve: "platformPushEvents.schedule_approve",
  schedule_reject: "platformPushEvents.schedule_reject",
  leave_request: "platformPushEvents.leave_request",
  leave_decision: "platformPushEvents.leave_decision",
  leave_cancel: "platformPushEvents.leave_cancel",
  break_start: "platformPushEvents.break_start",
  break_end: "platformPushEvents.break_end",
  break_late: "platformPushEvents.break_late",
  break_approval: "platformPushEvents.break_approval",
  custody_take: "platformPushEvents.custody_take",
  custody_return: "platformPushEvents.custody_return",
  management_on_shift: "platformPushEvents.management_on_shift",
  tasks: "platformPushEvents.tasks",
  messages: "platformPushEvents.messages",
  control_log: "platformPushEvents.control_log",
};

export function getPlatformPushEventLabel(key: PlatformPushEventKey): string {
  const i18nKey = PLATFORM_PUSH_EVENT_I18N[key];
  return i18nKey ? i18n.t(i18nKey) : key;
}

export const PLATFORM_PUSH_EVENTS = PLATFORM_PUSH_EVENT_DEFS.map((ev) => ({
  ...ev,
  label: getPlatformPushEventLabel(ev.key),
}));

export const PLATFORM_PUSH_EVENT_KEYS = PLATFORM_PUSH_EVENT_DEFS.map((e) => e.key);

export function isPlatformPushEventKey(value: string): value is PlatformPushEventKey {
  return (PLATFORM_PUSH_EVENT_KEYS as readonly string[]).includes(value);
}
