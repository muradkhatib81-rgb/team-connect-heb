import {
  branchPeriodConfigFromSettings,
  DEFAULT_PERIOD_CONFIG,
  normalizeMonthlyWorkingDows,
  type BranchPeriodConfig,
} from "@/lib/schedule-period-config";
import type { ScheduleType } from "@/lib/use-company-settings";

function configFromRpcPayload(raw: unknown): BranchPeriodConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.schedule_type == null && row.week_start_dow == null) return null;
  return branchPeriodConfigFromSettings(row);
}

/** Branch schedule period config — shared by client hook and server functions. */
export async function fetchSchedulePeriodConfig(
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
    from: (table: string) => any;
  },
  branchId: string | null,
): Promise<BranchPeriodConfig> {
  const { data: rpcData, error: rpcErr } = await supabase.rpc("get_schedule_period_settings", {
    p_branch_id: branchId,
  });
  if (!rpcErr) {
    const fromRpc = configFromRpcPayload(rpcData);
    if (fromRpc) return fromRpc;
  }

  let query = supabase
    .from("company_settings")
    .select("schedule_type, week_start_dow, week_end_dow, monthly_working_dows, extra, branch_id")
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (branchId) {
    query = query.eq("branch_id", branchId);
  }

  const { data: scoped, error: scopedErr } = await query.limit(1).maybeSingle();
  if (!scopedErr && scoped) {
    return mergeCompanyRowWithPeriodExtra(scoped as Record<string, unknown>);
  }

  const { data: fallback } = await supabase
    .from("company_settings")
    .select("schedule_type, week_start_dow, week_end_dow, monthly_working_dows, extra")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fallback) {
    return mergeCompanyRowWithPeriodExtra(fallback as Record<string, unknown>);
  }

  return DEFAULT_PERIOD_CONFIG;
}

export type StoredSchedulePeriod = {
  schedule_type: ScheduleType;
  week_start_dow: number;
  week_end_dow: number;
  monthly_working_dows: number[];
};

export const SCHEDULE_PERIOD_EXTRA_KEY = "schedule_period";

function coerceDow(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (Number.isInteger(n) && n >= 0 && n <= 6) return n;
  }
  return undefined;
}

export function readSchedulePeriodFromExtra(extra: unknown): Partial<StoredSchedulePeriod> | null {
  if (!extra || typeof extra !== "object") return null;
  const raw = (extra as Record<string, unknown>)[SCHEDULE_PERIOD_EXTRA_KEY];
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return {
    schedule_type: (row.schedule_type as ScheduleType) ?? undefined,
    week_start_dow: coerceDow(row.week_start_dow),
    week_end_dow: coerceDow(row.week_end_dow),
    monthly_working_dows: Array.isArray(row.monthly_working_dows)
      ? row.monthly_working_dows
          .map((d) => coerceDow(d))
          .filter((d): d is number => typeof d === "number")
      : undefined,
  };
}

export function mergeCompanyRowWithPeriodExtra(row: Record<string, unknown>): BranchPeriodConfig {
  const fromExtra = readSchedulePeriodFromExtra(row.extra);
  return branchPeriodConfigFromSettings({
    schedule_type: fromExtra?.schedule_type ?? row.schedule_type,
    week_start_dow: fromExtra?.week_start_dow ?? row.week_start_dow,
    week_end_dow: fromExtra?.week_end_dow ?? row.week_end_dow,
    monthly_working_dows: fromExtra?.monthly_working_dows ?? row.monthly_working_dows,
  });
}

export function buildSchedulePeriodPayload(input: StoredSchedulePeriod): StoredSchedulePeriod {
  return {
    schedule_type: input.schedule_type,
    week_start_dow: input.week_start_dow,
    week_end_dow: input.week_end_dow,
    monthly_working_dows: normalizeMonthlyWorkingDows(input.monthly_working_dows),
  };
}

export function buildCompanySettingsPeriodUpdate(
  existingExtra: unknown,
  period: StoredSchedulePeriod,
): {
  schedule_type: ScheduleType;
  week_start_dow: number;
  week_end_dow: number;
  monthly_working_dows: number[];
  extra: Record<string, unknown>;
} {
  const normalized = buildSchedulePeriodPayload(period);
  const extra =
    existingExtra && typeof existingExtra === "object"
      ? { ...(existingExtra as Record<string, unknown>) }
      : {};
  extra[SCHEDULE_PERIOD_EXTRA_KEY] = normalized;
  return { ...normalized, extra };
}
