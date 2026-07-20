import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isPlatformOwner, type AppRole } from "@/lib/constants";

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
  canOpenSettings: boolean;
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

export function custodyVisibleQueryKey(userId: string | null) {
  return ["custody-board-visible", userId] as const;
}

export async function fetchCustodyBoardVisible(): Promise<boolean> {
  const { data, error } = await (supabase as any).rpc("is_custody_board_visible");
  if (error) throw error;
  return !!data;
}

export async function fetchCustodyUserCaps(userId: string): Promise<CustodyUserCaps> {
  const [{ data: roles }, { data: perm }] = await Promise.all([
    supabase.from("user_roles").select("role").eq("user_id", userId),
    supabase
      .from("user_task_permissions")
      .select(
        "can_create_custody, can_edit_custody, can_delete_custody, can_return_custody, can_configure_custody, can_view_custody_daily_log, can_run_custody_monthly_report",
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
  const canConfigure = owner || !!(p as any).can_configure_custody;
  const canViewDailyLog = owner || !!(p as any).can_view_custody_daily_log;
  const canRunMonthlyReport = owner || !!(p as any).can_run_custody_monthly_report;
  const canOpenSettings = canCreate || canEdit || canDelete || canConfigure;
  return {
    isPlatformOwner: owner,
    canCreate,
    canEdit,
    canDelete,
    canReturnOthers,
    canConfigure,
    canViewDailyLog,
    canRunMonthlyReport,
    canOpenSettings,
  };
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
  });
  if (error) throw error;
  return data as string;
}

export async function upsertCustodyBranchSettings(input: {
  default_employee_reminder_minutes?: number;
  manager_midnight_warning_minutes?: number;
  daily_log_reset_hours?: number;
}): Promise<void> {
  const { error } = await (supabase as any).rpc("upsert_custody_branch_settings", {
    _default_employee_reminder_minutes: input.default_employee_reminder_minutes ?? null,
    _manager_midnight_warning_minutes: input.manager_midnight_warning_minutes ?? null,
    _daily_log_reset_hours: input.daily_log_reset_hours ?? null,
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

export async function checkoutCustodyItem(itemTypeId: string): Promise<string> {
  const { data, error } = await (supabase as any).rpc("checkout_custody_item", {
    _item_type_id: itemTypeId,
  });
  if (error) throw error;
  return data as string;
}

export async function returnCustodyItem(checkoutId: string): Promise<void> {
  const { error } = await (supabase as any).rpc("return_custody_item", {
    _checkout_id: checkoutId,
  });
  if (error) throw error;
}

export function invalidateCustodyQueries(qc: QueryClient, branchId: string | null, userId?: string) {
  qc.invalidateQueries({ queryKey: custodyQueryKey(branchId) });
  qc.invalidateQueries({ queryKey: custodySettingsQueryKey(branchId) });
  if (userId) qc.invalidateQueries({ queryKey: custodyVisibleQueryKey(userId) });
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
