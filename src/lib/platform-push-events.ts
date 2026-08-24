/** Platform-owner Web Push event catalog. Silent in-app bell is always on. */

export const PLATFORM_PUSH_EVENTS = [
  { key: "schedule_update", label: "סידור — עדכון / שינוי", group: "schedule" },
  { key: "schedule_publish", label: "סידור — פרסום", group: "schedule" },
  { key: "schedule_approve", label: "סידור — אישור", group: "schedule" },
  { key: "schedule_reject", label: "סידור — דחייה", group: "schedule" },
  { key: "leave_request", label: "חופשה — בקשה חדשה (למאשרים)", group: "leave" },
  { key: "leave_decision", label: "חופשה — אישור / דחייה לעובד", group: "leave" },
  { key: "leave_cancel", label: "חופשה — ביטול", group: "leave" },
  { key: "break_start", label: "הפסקה — התחלה", group: "break" },
  { key: "break_end", label: "הפסקה — חזרה / סיום", group: "break" },
  { key: "break_late", label: "הפסקה — איחור בחזרה", group: "break" },
  { key: "break_approval", label: "הפסקה — בקשה לאישור", group: "break" },
  { key: "custody_take", label: "ציוד — לקיחה", group: "custody" },
  { key: "custody_return", label: "ציוד — החזרה", group: "custody" },
  { key: "management_on_shift", label: "ניהול במשמרת", group: "ops" },
  { key: "tasks", label: "משימות", group: "ops" },
  { key: "messages", label: "הודעות", group: "ops" },
  { key: "control_log", label: "יומן בקרה — רישום חדש", group: "ops" },
] as const;

export type PlatformPushEventKey = (typeof PLATFORM_PUSH_EVENTS)[number]["key"];

export const PLATFORM_PUSH_EVENT_KEYS = PLATFORM_PUSH_EVENTS.map((e) => e.key);

export function isPlatformPushEventKey(value: string): value is PlatformPushEventKey {
  return (PLATFORM_PUSH_EVENT_KEYS as readonly string[]).includes(value);
}
