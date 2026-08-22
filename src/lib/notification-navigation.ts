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
