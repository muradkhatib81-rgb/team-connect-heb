/**
 * Apply AI minute quotas from a billing plan (company or branch).
 * Used by owner billing UI and Stripe webhooks. Does not touch roles.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingPlan } from "@/core/managers/billing-manager";

export type AiGrantScopeType = "company" | "branch";

export type BillingAiEntitlement = {
  billing_plan: BillingPlan;
  monthly_minutes: number | null;
  default_provider_code: string;
};

export type BillingAiGrantSlice = {
  scope_type: AiGrantScopeType | "user";
  scope_id: string;
  quota_minutes: number | null;
  used_minutes: number;
  is_active: boolean;
  billing_plan: BillingPlan | null;
  provider_code: string | null;
};

export async function listBillingAiEntitlements(): Promise<BillingAiEntitlement[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("ai_plan_entitlements")
    .select("billing_plan, monthly_minutes, default_provider_code");
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BillingAiEntitlement[];
}

export async function listBillingAiGrants(): Promise<BillingAiGrantSlice[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("ai_grants")
    .select("scope_type, scope_id, quota_minutes, used_minutes, is_active, billing_plan, provider_code")
    .order("updated_at", { ascending: false });
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BillingAiGrantSlice[];
}

export async function applyAiGrantFromBillingPlan(opts: {
  scopeType: AiGrantScopeType;
  scopeId: string;
  plan: BillingPlan;
  grantedBy?: string | null;
  resetUsage?: boolean;
  /** `undefined` = catalog default; `null` = unlimited */
  quotaMinutes?: number | null;
  isActive?: boolean;
}): Promise<{ ok: boolean; skipped?: string }> {
  const { data: ent, error: entErr } = await (supabaseAdmin as any)
    .from("ai_plan_entitlements")
    .select("billing_plan, monthly_minutes, default_provider_code")
    .eq("billing_plan", opts.plan)
    .maybeSingle();
  if (entErr) {
    if (/does not exist|relation/i.test(entErr.message)) {
      return { ok: false, skipped: "ai_plan_entitlements missing" };
    }
    throw new Error(entErr.message);
  }
  if (!ent) return { ok: false, skipped: "planNotFound" };

  const quotaMinutes = opts.quotaMinutes === undefined ? (ent.monthly_minutes as number | null) : opts.quotaMinutes;

  let usedMinutes = 0;
  let periodStartedAt = new Date().toISOString();
  if (!opts.resetUsage) {
    const { data: existing } = await (supabaseAdmin as any)
      .from("ai_grants")
      .select("used_minutes, period_started_at, billing_plan")
      .eq("scope_type", opts.scopeType)
      .eq("scope_id", opts.scopeId)
      .maybeSingle();
    if (existing?.billing_plan === opts.plan) {
      usedMinutes = Number(existing.used_minutes ?? 0);
      periodStartedAt = existing.period_started_at ?? periodStartedAt;
    }
  }

  const { error } = await (supabaseAdmin as any).from("ai_grants").upsert(
    {
      scope_type: opts.scopeType,
      scope_id: opts.scopeId,
      provider_code: ent.default_provider_code,
      grant_source: "billing_plan",
      billing_plan: opts.plan,
      quota_minutes: quotaMinutes,
      quota_period: "monthly",
      is_active: opts.isActive ?? true,
      granted_by: opts.grantedBy ?? null,
      used_minutes: usedMinutes,
      period_started_at: periodStartedAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "scope_type,scope_id" },
  );
  if (error) {
    if (/does not exist|relation/i.test(error.message)) {
      return { ok: false, skipped: "ai_grants missing" };
    }
    throw new Error(error.message);
  }
  return { ok: true };
}

export async function applyCompanyAiGrantFromBillingPlan(opts: {
  companyId: string;
  plan: BillingPlan;
  grantedBy?: string | null;
  resetUsage?: boolean;
}): Promise<{ ok: boolean; skipped?: string }> {
  return applyAiGrantFromBillingPlan({
    scopeType: "company",
    scopeId: opts.companyId,
    plan: opts.plan,
    grantedBy: opts.grantedBy,
    resetUsage: opts.resetUsage,
  });
}
