/**
 * Storage quotas by billing plan (company / branch).
 * Quotas are set on /platform/billing. Upload enforcement can use these later.
 * Does not touch roles.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingPlan } from "@/core/managers/billing-manager";

export type StorageGrantScopeType = "company" | "branch";

export type BillingStorageEntitlement = {
  billing_plan: BillingPlan;
  storage_quota_mb: number | null;
};

export type BillingStorageGrantSlice = {
  scope_type: StorageGrantScopeType;
  scope_id: string;
  storage_quota_mb: number | null;
  used_bytes: number;
  is_active: boolean;
  billing_plan: BillingPlan | null;
};

export {
  formatUsedBytes,
  gbToMb,
  MB,
  mbToGbInput,
  mbToGbLabel,
} from "@/lib/billing-storage";

function isMissingRelation(message: string) {
  return /does not exist|relation|schema cache|could not find the table/i.test(message);
}

export async function listBillingStorageEntitlements(): Promise<BillingStorageEntitlement[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_storage_entitlements")
    .select("billing_plan, storage_quota_mb");
  if (error) {
    if (isMissingRelation(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BillingStorageEntitlement[];
}

export async function listBillingStorageGrants(): Promise<BillingStorageGrantSlice[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_storage_grants")
    .select("scope_type, scope_id, storage_quota_mb, used_bytes, is_active, billing_plan")
    .order("updated_at", { ascending: false });
  if (error) {
    if (isMissingRelation(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BillingStorageGrantSlice[];
}

export async function applyStorageGrantFromBillingPlan(opts: {
  scopeType: StorageGrantScopeType;
  scopeId: string;
  plan: BillingPlan;
  grantedBy?: string | null;
  /** `undefined` = catalog default; `null` = unlimited */
  storageQuotaMb?: number | null;
  isActive?: boolean;
}): Promise<{ ok: boolean; skipped?: string }> {
  const { data: ent, error: entErr } = await (supabaseAdmin as any)
    .from("billing_storage_entitlements")
    .select("billing_plan, storage_quota_mb")
    .eq("billing_plan", opts.plan)
    .maybeSingle();
  if (entErr) {
    if (isMissingRelation(entErr.message)) {
      return { ok: false, skipped: "billing_storage_entitlements missing" };
    }
    throw new Error(entErr.message);
  }
  if (!ent) return { ok: false, skipped: "planNotFound" };

  const storageQuotaMb =
    opts.storageQuotaMb === undefined ? (ent.storage_quota_mb as number | null) : opts.storageQuotaMb;

  const { data: existing } = await (supabaseAdmin as any)
    .from("billing_storage_grants")
    .select("used_bytes")
    .eq("scope_type", opts.scopeType)
    .eq("scope_id", opts.scopeId)
    .maybeSingle();

  const { error } = await (supabaseAdmin as any).from("billing_storage_grants").upsert(
    {
      scope_type: opts.scopeType,
      scope_id: opts.scopeId,
      billing_plan: opts.plan,
      storage_quota_mb: storageQuotaMb,
      used_bytes: Number(existing?.used_bytes ?? 0),
      is_active: opts.isActive ?? true,
      granted_by: opts.grantedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scope_type,scope_id" },
  );
  if (error) {
    if (isMissingRelation(error.message)) {
      return { ok: false, skipped: "billing_storage_grants missing" };
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

export async function applyCompanyStorageFromBillingPlan(opts: {
  companyId: string;
  plan: BillingPlan;
  grantedBy?: string | null;
}): Promise<{ ok: boolean; skipped?: string }> {
  return applyStorageGrantFromBillingPlan({
    scopeType: "company",
    scopeId: opts.companyId,
    plan: opts.plan,
    grantedBy: opts.grantedBy,
  });
}
