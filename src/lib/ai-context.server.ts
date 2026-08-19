import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AiAssistantKind } from "@/modules/ai";
import { getScheduleWeek } from "@/lib/schedule-week";
import { todayJerusalemDate } from "@/lib/break-workflow";

type Db = SupabaseClient<Database>;

function jerusalemTodayIso(): string {
  return todayJerusalemDate();
}

function leaveAvailable(row: {
  manual_balance?: number | null;
  accrued_days?: number | null;
  used_days?: number | null;
  reserved_days?: number | null;
}): number {
  return (
    (row.manual_balance ?? 0) +
    (row.accrued_days ?? 0) -
    (row.used_days ?? 0) -
    (row.reserved_days ?? 0)
  );
}

async function fetchEmployeeAiContext(supabase: Db, userId: string): Promise<string> {
  const today = jerusalemTodayIso();
  const { weekStart, weekDays } = getScheduleWeek(new Date(`${today}T12:00:00Z`));

  const [profileRes, balancesRes, requestsRes, breaksRes] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "full_name, first_name, last_name, job_title, department_id, on_leave, leave_start_date, leave_end_date, departments(name)",
      )
      .eq("id", userId)
      .maybeSingle(),
    (supabase as any)
      .from("leave_balances")
      .select("manual_balance, accrued_days, used_days, reserved_days, leave_types(name, code)")
      .eq("user_id", userId),
    (supabase as any)
      .from("leave_requests")
      .select("status, start_date, end_date, submitted_at, leave_types(name, code)")
      .eq("user_id", userId)
      .order("submitted_at", { ascending: false })
      .limit(5),
    supabase
      .from("break_requests")
      .select("status, duration_minutes, requested_at, started_at, ends_at, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const profile = profileRes.data as {
    full_name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    job_title?: string | null;
    department_id?: string | null;
    on_leave?: boolean | null;
    leave_start_date?: string | null;
    leave_end_date?: string | null;
    departments?: { name?: string | null } | null;
  } | null;

  const displayName =
    profile?.full_name?.trim() ||
    [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() ||
    "—";

  const balances = ((balancesRes.data ?? []) as Array<{
    manual_balance?: number | null;
    accrued_days?: number | null;
    used_days?: number | null;
    reserved_days?: number | null;
    leave_types?: { name?: string | null; code?: string | null } | null;
  }>).map((row) => ({
    type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
    availableDays: Math.round(leaveAvailable(row) * 100) / 100,
  }));

  const recentLeaveRequests = ((requestsRes.data ?? []) as Array<{
    status?: string;
    start_date?: string;
    end_date?: string;
    leave_types?: { name?: string | null; code?: string | null } | null;
  }>).map((row) => ({
    type: row.leave_types?.name ?? row.leave_types?.code ?? "leave",
    status: row.status ?? "unknown",
    from: row.start_date ?? "",
    to: row.end_date ?? "",
  }));

  const breakRows = (breaksRes.data ?? []) as Array<{
    status?: string;
    duration_minutes?: number;
    requested_at?: string;
    started_at?: string | null;
    ends_at?: string | null;
    created_at?: string;
  }>;

  const breaksToday = breakRows.filter((row) => {
    const stamp = row.started_at ?? row.requested_at ?? row.created_at ?? "";
    return stamp.slice(0, 10) === today;
  });

  let weekSchedule: Array<{ date: string; shift: string; leaveCode?: string | null }> = [];

  if (profile?.department_id) {
    const { data: scheds } = await supabase
      .from("schedules")
      .select("id")
      .eq("department_id", profile.department_id)
      .eq("week_start", weekStart)
      .eq("status", "approved")
      .not("published_at", "is", null);

    const scheduleIds = (scheds ?? []).map((s) => s.id);
    if (scheduleIds.length > 0) {
      const { data: shiftRows } = await (supabase as any)
        .from("schedule_shifts")
        .select("day_date, shift, leave_type_code")
        .eq("employee_id", userId)
        .in("schedule_id", scheduleIds)
        .in("day_date", weekDays);

      weekSchedule = ((shiftRows ?? []) as Array<{
        day_date: string;
        shift: string;
        leave_type_code?: string | null;
      }>)
        .map((row) => ({
          date: row.day_date as string,
          shift: row.shift as string,
          leaveCode: (row.leave_type_code as string | null) ?? null,
        }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }
  }

  const snapshot = {
    asOfDate: today,
    profile: {
      name: displayName,
      jobTitle: profile?.job_title ?? null,
      department: profile?.departments?.name ?? null,
      onLeaveNow: !!profile?.on_leave,
      leaveUntil: profile?.on_leave ? profile.leave_end_date : null,
    },
    leaveBalances: balances,
    recentLeaveRequests,
    breaksToday: breaksToday.map((row) => ({
      status: row.status ?? "unknown",
      durationMinutes: row.duration_minutes ?? null,
    })),
    scheduleThisWeek: weekSchedule.length
      ? { weekStart, days: weekSchedule }
      : { weekStart, days: [], note: "No published schedule shifts found for this week." },
  };

  return JSON.stringify(snapshot, null, 2);
}

/** Read-only employee data for AI prompts. Uses the caller's session (RLS). */
export async function buildAiUserContext(
  supabase: Db,
  assistantKind: AiAssistantKind,
): Promise<string | null> {
  if (assistantKind !== "employee") return null;

  const { data: authData, error: authErr } = await supabase.auth.getUser();
  if (authErr || !authData.user?.id) return null;

  try {
    return await fetchEmployeeAiContext(supabase, authData.user.id);
  } catch {
    return null;
  }
}
