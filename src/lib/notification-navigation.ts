/** Deep-link to the schedules page for a specific period (matches ?week= search param). */
export function scheduleNotificationPushUrl(weekStart?: string | null): string {
  const week = weekStart?.slice(0, 10);
  return week ? `/schedules?week=${encodeURIComponent(week)}` : "/schedules";
}

export function scheduleNotificationSearch(
  weekStart?: string | null,
): { week: string } | undefined {
  const week = weekStart?.slice(0, 10);
  return week ? { week } : undefined;
}

/** Route push / in-app notification clicks to the most relevant page. */
export function notificationPushUrl(
  message: string,
  opts?: { scheduleId?: string | null; weekStart?: string | null; messageId?: string | null },
): string {
  if (opts?.messageId) return "/communications";
  const m = message.trim();
  if (opts?.scheduleId || /סידור|schedule|לוח/i.test(m)) {
    return scheduleNotificationPushUrl(opts?.weekStart);
  }
  if (/משימה|task/i.test(m)) return "/tasks";
  if (/הודעה|message|תקשורת/i.test(m)) return "/communications";
  if (/משמרת|management on shift|במשמרת/i.test(m)) return "/dashboard";
  if (/הפסקה|break/i.test(m)) return "/dashboard";
  if (/חופש|leave/i.test(m)) return "/dashboard";
  if (/מזומנ|custody|כסף/i.test(m)) return "/dashboard";
  return "/dashboard";
}

export function notificationLinkTarget(
  message: string,
  opts?: { scheduleId?: string | null; weekStart?: string | null },
): { to: string; search?: { week: string } } {
  const url = notificationPushUrl(message, opts);
  const qIndex = url.indexOf("?");
  if (qIndex === -1) return { to: url };
  const week = new URLSearchParams(url.slice(qIndex + 1)).get("week");
  if (week) return { to: url.slice(0, qIndex), search: { week } };
  return { to: url.slice(0, qIndex) };
}
