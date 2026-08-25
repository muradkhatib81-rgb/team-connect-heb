/**
 * Resolve plan limits, trial windows, and usage gates per company.
 * Does not read or write user_roles / user_task_permissions.
 */

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingPlan } from "@/core/managers/billing-manager";
import { applyCompanyAiGrantFromBillingPlan } from "@/lib/billing-ai-sync.server";
import { applyCompanyStorageFromBillingPlan } from "@/lib/billing-storage.server";
import { billingErrorCode } from "@/lib/billing-errors";
import type { BillingAccountRow } from "@/lib/billing-store.server";
import {
  DEFAULT_PLAN_ENTITLEMENTS,
  DEFAULT_TRIAL_DAYS,
  type PlanEntitlementRow,
} from "@/lib/billing-entitlements";

export type CompanyBillingState = {
  companyId: string;
  storedPlan: BillingPlan;
  effectivePlan: BillingPlan;
  status: string;
  trialEndsAt: string | null;
  isTrialActive: boolean;
  entitlements: PlanEntitlementRow;
  usage: { employees: number; branches: number };
};

function isTrialActive(row: Pick<BillingAccountRow, "status" | "trial_ends_at">): boolean {
  return (
    row.status === "trialing" &&
    !!row.trial_ends_at &&
    new Date(row.trial_ends_at).getTime() > Date.now()
  );
}

/** Effective plan for quotas — trial mirrors standard until trial_ends_at. */
export function resolveEffectivePlan(
  row: Pick<BillingAccountRow, "plan" | "status" | "grace_until" | "trial_ends_at">,
): BillingPlan {
  if (row.status === "canceled" || row.status === "unpaid" || row.status === "incomplete_expired") {
    return "free";
  }
  if (row.status === "past_due" && row.grace_until && new Date(row.grace_until).getTime() < Date.now()) {
    return "free";
  }
  if (row.status === "trialing") {
    return isTrialActive(row) ? "standard" : "free";
  }
  return row.plan;
}

export async function listPlanEntitlements(): Promise<PlanEntitlementRow[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_plan_entitlements")
    .select("billing_plan, max_employees, max_branches, realtime_enabled, analytics_enabled, default_trial_days")
    .order("billing_plan");
  if (error) {
    if (/does not exist|relation/i.test(error.message)) {
      return Object.values(DEFAULT_PLAN_ENTITLEMENTS);
    }
    throw new Error(error.message);
  }
  return (data ?? []) as PlanEntitlementRow[];
}

export async function getPlanEntitlement(plan: BillingPlan): Promise<PlanEntitlementRow> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_plan_entitlements")
    .select("billing_plan, max_employees, max_branches, realtime_enabled, analytics_enabled, default_trial_days")
    .eq("billing_plan", plan)
    .maybeSingle();
  if (error) {
    if (/does not exist|relation/i.test(error.message)) {
      return DEFAULT_PLAN_ENTITLEMENTS[plan];
    }
    throw new Error(error.message);
  }
  return (data as PlanEntitlementRow | null) ?? DEFAULT_PLAN_ENTITLEMENTS[plan];
}

async function loadBillingAccount(companyId: string): Promise<BillingAccountRow | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .select("*")
    .eq("company_id", companyId)
    .maybeSingle();
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data as BillingAccountRow | null) ?? null;
}

async function downgradeExpiredTrial(companyId: string, row: BillingAccountRow): Promise<BillingAccountRow> {
  const now = new Date().toISOString();
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .update({
      plan: "free",
      status: "active",
      trial_ends_at: null,
      updated_at: now,
    })
    .eq("id", row.id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  await applyCompanyAiGrantFromBillingPlan({ companyId, plan: "free", resetUsage: true });
  await applyCompanyStorageFromBillingPlan({ companyId, plan: "free" });
  return data as BillingAccountRow;
}

export async function expireTrialIfNeeded(companyId: string): Promise<BillingAccountRow | null> {
  const row = await loadBillingAccount(companyId);
  if (!row) return null;
  if (row.status !== "trialing" || !row.trial_ends_at) return row;
  if (new Date(row.trial_ends_at).getTime() > Date.now()) return row;
  return downgradeExpiredTrial(companyId, row);
}

export async function companyIdForPhysicalBranch(branchId: string): Promise<string | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("company_branch_assignments")
    .select("company_id")
    .eq("source_branch_id", branchId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data?.company_id as string | undefined) ?? null;
}

export async function countCompanyBranches(companyId: string): Promise<number> {
  const { count, error } = await (supabaseAdmin as any)
    .from("company_branch_assignments")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return 0;
    throw new Error(error.message);
  }
  return count ?? 0;
}

export async function countCompanyEmployees(companyId: string): Promise<number> {
  const { data: assignments, error: aErr } = await (supabaseAdmin as any)
    .from("company_branch_assignments")
    .select("source_branch_id")
    .eq("company_id", companyId)
    .is("deleted_at", null);
  if (aErr) {
    if (/does not exist|relation/i.test(aErr.message)) return 0;
    throw new Error(aErr.message);
  }
  const branchIds = (assignments ?? [])
    .map((a: { source_branch_id: string }) => a.source_branch_id)
    .filter(Boolean);
  if (!branchIds.length) return 0;

  const { count, error } = await (supabaseAdmin as any)
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .in("branch_id", branchIds);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getCompanyBillingState(companyId: string): Promise<CompanyBillingState> {
  const row = (await expireTrialIfNeeded(companyId)) ?? {
    plan: "free" as BillingPlan,
    status: "active",
    trial_ends_at: null,
    grace_until: null,
  };
  const effectivePlan = resolveEffectivePlan(row);
  const entitlements = await getPlanEntitlement(effectivePlan);
  const [employees, branches] = await Promise.all([
    countCompanyEmployees(companyId),
    countCompanyBranches(companyId),
  ]);
  return {
    companyId,
    storedPlan: row.plan ?? "free",
    effectivePlan,
    status: row.status ?? "active",
    trialEndsAt: row.trial_ends_at ?? null,
    isTrialActive: isTrialActive(row),
    entitlements,
    usage: { employees, branches },
  };
}

function limitMessage(kind: "employees" | "branches", limit: number, plan: BillingPlan): string {
  return billingErrorCode(kind === "employees" ? "employeeLimitExceeded" : "branchLimitExceeded", {
    limit,
    plan,
  });
}

export async function assertCanAddEmployee(companyId: string): Promise<void> {
  const state = await getCompanyBillingState(companyId);
  const max = state.entitlements.max_employees;
  if (max == null) return;
  if (state.usage.employees >= max) {
    throw new Error(limitMessage("employees", max, state.effectivePlan));
  }
}

export async function assertCanAddBranch(companyId: string): Promise<void> {
  const state = await getCompanyBillingState(companyId);
  const max = state.entitlements.max_branches;
  if (max == null) return;
  if (state.usage.branches >= max) {
    throw new Error(limitMessage("branches", max, state.effectivePlan));
  }
}

export async function startCompanyTrial(opts: {
  companyId: string;
  days?: number;
  updatedBy: string;
}): Promise<{ trialEndsAt: string }> {
  const row = await expireTrialIfNeeded(opts.companyId);
  const days = opts.days ?? DEFAULT_TRIAL_DAYS;

  if (row?.source === "stripe" && row.status === "active" && row.stripe_subscription_id) {
    throw new Error(billingErrorCode("stripeActiveNoTrial"));
  }
  if (row && isTrialActive(row)) {
    throw new Error(billingErrorCode("trialAlreadyActive"));
  }
  if (row && resolveEffectivePlan(row) !== "free") {
    throw new Error(billingErrorCode("trialOnlyOnFree"));
  }

  const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();
  const payload = {
    company_id: opts.companyId,
    plan: "standard" as const,
    source: "manual" as const,
    status: "trialing",
    trial_ends_at: trialEndsAt,
    grace_until: null,
    updated_by: opts.updatedBy,
    updated_at: now,
  };

  if (row?.id) {
    const { error } = await (supabaseAdmin as any).from("billing_accounts").update(payload).eq("id", row.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await (supabaseAdmin as any).from("billing_accounts").insert({ ...payload, created_at: now });
    if (error) throw new Error(error.message);
  }

  await applyCompanyAiGrantFromBillingPlan({
    companyId: opts.companyId,
    plan: "standard",
    grantedBy: opts.updatedBy,
    resetUsage: true,
  });
  await applyCompanyStorageFromBillingPlan({
    companyId: opts.companyId,
    plan: "standard",
    grantedBy: opts.updatedBy,
  });

  return { trialEndsAt };
}
