import { useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPlatformOwner, type AppRole } from "@/lib/constants";
import { todayJerusalemDate } from "@/lib/break-workflow";
import { fetchShiftSelfServiceVisible, shiftVisibleQueryKey } from "@/lib/shift-visible-rpc";

export type CustodyItemType = {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
};

export type CustodyActiveCheckout = {
  id: string;
  item_type_id: string;
  user_id: string;
  checked_out_at: string;
  full_name: string | null;
  department_name: string | null;
};

export type CustodyBoardSlot = CustodyItemType & {
  checkout: CustodyActiveCheckout | null;
};

export type CustodyUserCaps = {
  isPlatformOwner: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReturnOthers: boolean;
  canConfigure: boolean;
  canViewDailyLog: boolean;
  canRunMonthlyReport: boolean;
  canReceiveAlerts: boolean;
  canOpenSettings: boolean;
  /** בעל מערכת, or any explicit מערכת ניהול ציוד grant from /permissions. */
  canAccessCustodyLog: boolean;
};

export type CustodyLogRow = {
  id: string;
  itemName: string;
  userName: string;
  departmentName: string | null;
  checkedOutAt: string;
  returnedAt: string | null;
  durationMinutes: number | null;
  returnType: string | null;
  returnActorName: string | null;
  status: "active" | "returned";
  spansMidnight: boolean;
};

export type CustodyItemTypeRow = CustodyItemType & {
  employee_reminder_minutes: number | null;
};

export type CustodyBranchSettings = {
  branch_id: string;
  default_employee_reminder_minutes: number;
  manager_midnight_warning_minutes: number;
  daily_log_reset_hours: number;
};

export function custodySettingsQueryKey(branchId: string | null) {
  return ["custody-settings", branchId] as const;
}

export function custodyQueryKey(branchId: string | null) {
  return ["custody-board", branchId] as const;
}

export function custodyLogQueryKey(branchId: string | null) {
  return ["custody-daily-log", branchId] as const;
}

export function custodyVisibleQueryKey(userId: string | null, branchId?: string | null) {
  return shiftVisibleQueryKey(userId, branchId);
}

export async function fetchCustodyBoardVisible(branchId?: string | null): Promise<boolean> {
  return fetchShiftSelfServiceVisible(branchId);
}

export function custodyDurationMinutes(checkedOutAt: string, nowMs = Date.now()) {
  return Math.max(0, Math.round((nowMs - new Date(checkedOutAt).getTime()) / 60000));
}

export function fmtCustodyDuration(minutes: number | null) {
  if (minutes == null) return "—";
  if (minutes < 60) return `${minutes} דק׳`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} שע׳ ${m} דק׳` : `${h} שע׳`;
}

export async function fetchCustodyUserCaps(userId: string): Promise<CustodyUserCaps> {
  const [{ data: roles }, { data: perm }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("user_task_permissions")
      .select(
        "can_create_custody, can_edit_custody, can_delete_custody, can_return_custody, can_receive_custody_alerts, can_configure_custody, can_view_custody_daily_log, can_run_custody_monthly_report",
      )
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const roleList = (roles ?? []).map((r: { role: AppRole }) => r.role);
  const owner = isPlatformOwner(roleList);
  const p = perm ?? {};
  const canCreate = owner || !!(p as any).can_create_custody;
  const canEdit = owner || !!(p as any).can_edit_custody;
  const canDelete = owner || !!(p as any).can_delete_custody;
  const canReturnOthers = owner || !!(p as any).can_return_custody;
  const canReceiveAlerts = owner || !!(p as any).can_receive_custody_alerts;
  const canConfigure = owner || !!(p as any).can_configure_custody;
  const canViewDailyLog = owner || !!(p as any).can_view_custody_daily_log;
  const canRunMonthlyReport = owner || !!(p as any).can_run_custody_monthly_report;
  const canOpenSettings = canCreate || canEdit || canDelete || canConfigure;
  const canAccessCustodyLog =
    owner ||
    !!(p as any).can_create_custody ||
    !!(p as any).can_edit_custody ||
    !!(p as any).can_delete_custody ||
    !!(p as any).can_return_custody ||
    !!(p as any).can_receive_custody_alerts ||
    !!(p as any).can_configure_custody ||
    !!(p as any).can_view_custody_daily_log ||
    !!(p as any).can_run_custody_monthly_report;
  return {
    isPlatformOwner: owner,
    canCreate,
    canEdit,
    canDelete,
    canReturnOthers,
    canConfigure,
    canViewDailyLog,
    canRunMonthlyReport,
    canReceiveAlerts,
    canOpenSettings,
    canAccessCustodyLog,
  };
}

export async function fetchCustodyDailyLog(branchId: string): Promise<CustodyLogRow[]> {
  const today = todayJerusalemDate();
  const dayStart = `${today}T00:00:00+03:00`;
  const dayEnd = `${today}T23:59:59.999+03:00`;

  const [{ data: archive, error: archiveErr }, { data: active, error: activeErr }] =
    await Promise.all([
      supabase
        .from("custody_session_archive")
        .select(
          "id, item_name, user_name, department_name, checked_out_at, returned_at, duration_minutes, return_type, return_actor_name, spans_midnight",
        )
        .eq("branch_id", branchId)
        .gte("returned_at", dayStart)
        .lte("returned_at", dayEnd)
        .order("returned_at", { ascending: false }),
      supabase
        .from("custody_checkouts")
        .select("id, checked_out_at, user_id, department_id, item_type_id")
        .eq("branch_id", branchId)
        .eq("status", "active"),
    ]);
  if (archiveErr) throw archiveErr;
  if (activeErr) throw activeErr;

  const returned: CustodyLogRow[] = (archive ?? []).map((r: any) => ({
    id: r.id as string,
    itemName: r.item_name as string,
    userName: r.user_name as string,
    departmentName: (r.department_name as string | null) ?? null,
    checkedOutAt: r.checked_out_at as string,
    returnedAt: r.returned_at as string,
    durationMinutes: r.duration_minutes as number,
    returnType: r.return_type as string,
    returnActorName: (r.return_actor_name as string | null) ?? null,
    status: "returned" as const,
    spansMidnight: !!r.spans_midnight,
  }));

  const activeRows = (active ?? []) as Array<{
    id: string;
    checked_out_at: string;
    user_id: string;
    department_id: string | null;
    item_type_id: string;
  }>;

  if (activeRows.length === 0) {
    return returned;
  }

  const userIds = [...new Set(activeRows.map((r) => r.user_id))];
  const deptIds = [
    ...new Set(activeRows.map((r) => r.department_id).filter(Boolean)),
  ] as string[];
  const typeIds = [...new Set(activeRows.map((r) => r.item_type_id))];

  const [{ data: profs }, { data: depts }, { data: types }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", userIds),
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    supabase.from("custody_item_types").select("id, name").in("id", typeIds),
  ]);

  const profMap = new Map(
    (profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p.full_name]),
  );
  const deptMap = new Map(
    (depts ?? []).map((d: { id: string; name: string }) => [d.id, d.name]),
  );
  const typeMap = new Map(
    (types ?? []).map((t: { id: string; name: string }) => [t.id, t.name]),
  );

  const now = Date.now();
  const activeLog: CustodyLogRow[] = activeRows.map((r) => {
    const checkedMs = new Date(r.checked_out_at).getTime();
    return {
      id: r.id,
      itemName: typeMap.get(r.item_type_id) ?? "—",
      userName: profMap.get(r.user_id) ?? "—",
      departmentName: r.department_id ? deptMap.get(r.department_id) ?? null : null,
      checkedOutAt: r.checked_out_at,
      returnedAt: null,
      durationMinutes: Math.max(0, Math.round((now - checkedMs) / 60000)),
      returnType: null,
      returnActorName: null,
      status: "active",
      spansMidnight:
        new Date(r.checked_out_at).toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" }) !==
        today,
    };
  });

  return [...activeLog, ...returned].sort(
    (a, b) => new Date(b.checkedOutAt).getTime() - new Date(a.checkedOutAt).getTime(),
  );
}

/** Suggested name for the next equipment item: ציוד 1, ציוד 2, … */
export function suggestNextEquipmentName(existing: ReadonlyArray<{ name: string }>): string {
  let max = 0;
  const re = /^ציוד\s*(\d+)\s*$/i;
  for (const row of existing) {
    const m = row.name.trim().match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `ציוד ${max + 1}`;
}

export async function fetchCustodyItemTypes(branchId: string): Promise<CustodyItemTypeRow[]> {
  const { data, error } = await supabase
    .from("custody_item_types")
    .select("id, name, sort_order, is_active, employee_reminder_minutes")
    .eq("branch_id", branchId)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as CustodyItemTypeRow[];
}

export async function fetchCustodyBranchSettings(
  branchId: string,
): Promise<CustodyBranchSettings | null> {
  const { data, error } = await supabase
    .from("custody_branch_settings")
    .select(
      "branch_id, default_employee_reminder_minutes, manager_midnight_warning_minutes, daily_log_reset_hours",
    )
    .eq("branch_id", branchId)
    .maybeSingle();
  if (error) throw error;
  return (data as CustodyBranchSettings | null) ?? null;
}

export async function upsertCustodyItemType(input: {
  branchId: string;
  id?: string | null;
  name: string;
  sort_order?: number;
  is_active?: boolean;
  employee_reminder_minutes?: number | null;
}): Promise<string> {
  const { data, error } = await (supabase as any).rpc("upsert_custody_item_type", {
    _name: input.name,
    _id: input.id ?? null,
    _sort_order: input.sort_order ?? 0,
    _is_active: input.is_active ?? true,
    _employee_reminder_minutes: input.employee_reminder_minutes ?? null,
    _branch_id: input.branchId,
  });
  if (error) throw error;
  return data as string;
}

export async function upsertCustodyBranchSettings(input: {
  branchId: string;
  default_employee_reminder_minutes?: number;
  manager_midnight_warning_minutes?: number;
  daily_log_reset_hours?: number;
}): Promise<void> {
  const { error } = await (supabase as any).rpc("upsert_custody_branch_settings", {
    _default_employee_reminder_minutes: input.default_employee_reminder_minutes ?? null,
    _manager_midnight_warning_minutes: input.manager_midnight_warning_minutes ?? null,
    _daily_log_reset_hours: input.daily_log_reset_hours ?? null,
    _branch_id: input.branchId,
  });
  if (error) throw error;
}

export async function fetchCustodyBoard(branchId: string): Promise<CustodyBoardSlot[]> {
  const [{ data: types, error: typesErr }, { data: checkouts, error: coErr }] =
    await Promise.all([
      supabase
        .from("custody_item_types")
        .select("id, name, sort_order, is_active")
        .eq("branch_id", branchId)
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true }),
      supabase
        .from("custody_checkouts")
        .select("id, item_type_id, user_id, checked_out_at, department_id")
        .eq("branch_id", branchId)
        .eq("status", "active"),
    ]);
  if (typesErr) throw typesErr;
  if (coErr) throw coErr;

  const active = (checkouts ?? []) as Array<{
    id: string;
    item_type_id: string;
    user_id: string;
    checked_out_at: string;
    department_id: string | null;
  }>;
  if (active.length === 0) {
    return ((types ?? []) as CustodyItemType[]).map((t) => ({
      ...t,
      checkout: null,
    }));
  }

  const userIds = [...new Set(active.map((c) => c.user_id))];
  const deptIds = [
    ...new Set(active.map((c) => c.department_id).filter(Boolean)),
  ] as string[];

  const [{ data: profs }, { data: depts }] = await Promise.all([
    supabase.from("profiles").select("id, full_name").in("id", userIds),
    deptIds.length
      ? supabase.from("departments").select("id, name").in("id", deptIds)
      : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);

  const profMap = new Map(
    (profs ?? []).map((p: { id: string; full_name: string | null }) => [p.id, p]),
  );
  const deptMap = new Map(
    (depts ?? []).map((d: { id: string; name: string }) => [d.id, d.name]),
  );

  const checkoutByItem = new Map<string, CustodyActiveCheckout>();
  for (const c of active) {
    const p = profMap.get(c.user_id);
    checkoutByItem.set(c.item_type_id, {
      id: c.id,
      item_type_id: c.item_type_id,
      user_id: c.user_id,
      checked_out_at: c.checked_out_at,
      full_name: p?.full_name ?? null,
      department_name: c.department_id ? deptMap.get(c.department_id) ?? null : null,
    });
  }

  return ((types ?? []) as CustodyItemType[]).map((t) => ({
    ...t,
    checkout: checkoutByItem.get(t.id) ?? null,
  }));
}

export async function checkoutCustodyItem(
  itemTypeId: string,
  branchId: string,
): Promise<string> {
  const { data, error } = await (supabase as any).rpc("checkout_custody_item", {
    _item_type_id: itemTypeId,
    _branch_id: branchId,
  });
  if (error) throw error;
  return data as string;
}

export async function returnCustodyItem(
  checkoutId: string,
  branchId: string,
): Promise<void> {
  const { error } = await (supabase as any).rpc("return_custody_item", {
    _checkout_id: checkoutId,
    _branch_id: branchId,
  });
  if (error) throw error;
}

export function invalidateCustodyQueries(qc: QueryClient, branchId: string | null, userId?: string) {
  qc.invalidateQueries({ queryKey: custodyQueryKey(branchId) });
  qc.invalidateQueries({ queryKey: custodySettingsQueryKey(branchId) });
  qc.invalidateQueries({ queryKey: custodyLogQueryKey(branchId) });
  if (userId) {
    qc.invalidateQueries({ queryKey: ["custody-board-visible", userId] });
  }
}

/** Supabase Realtime — instant refresh when checkouts / returns change. */
export function useCustodyRealtime(
  branchId: string | null,
  userId: string | undefined,
  enabled: boolean,
) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!enabled || !branchId || !userId) return;
    const ch = supabase
      .channel(`custody-realtime-${userId}-${branchId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "custody_checkouts",
          filter: `branch_id=eq.${branchId}`,
        },
        () => invalidateCustodyQueries(qc, branchId, userId),
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "custody_session_archive",
          filter: `branch_id=eq.${branchId}`,
        },
        () => invalidateCustodyQueries(qc, branchId, userId),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [branchId, userId, enabled, qc]);
}

/** 24-hour time (HH:mm) in Jerusalem. */
export function custodyTimeHM(iso: string) {
  return new Date(iso).toLocaleTimeString("he-IL", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
