/**
 * Platform billing — durable plans + Stripe checkout/portal.
 * Isolated from user_roles / user_task_permissions.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingPlan } from "@/core/managers/billing-manager";
import {
  applyAiGrantFromBillingPlan,
  applyCompanyAiGrantFromBillingPlan,
  listBillingAiEntitlements,
  listBillingAiGrants,
  type BillingAiEntitlement,
  type BillingAiGrantSlice,
} from "@/lib/billing-ai-sync.server";
import {
  applyCompanyStorageFromBillingPlan,
  applyStorageGrantFromBillingPlan,
  listBillingStorageEntitlements,
  listBillingStorageGrants,
  type BillingStorageEntitlement,
  type BillingStorageGrantSlice,
} from "@/lib/billing-storage.server";
import {
  effectivePlan,
  listBillingAccounts,
  listRecentPayments,
  loadPlatformAccount,
  saveStripeCustomerId,
  upsertManualPlan,
  type BillingAccountRow,
} from "@/lib/billing-store.server";
import {
  getCompanyBillingState,
  listPlanEntitlements,
  startCompanyTrial,
  type CompanyBillingState,
} from "@/lib/billing-entitlements.server";
import type { PlanEntitlementRow } from "@/lib/billing-entitlements";
import { billingErrorCode } from "@/lib/billing-errors";
import {
  appPublicUrl,
  getStripe,
  isStripeCheckoutConfigured,
  isStripeConfigured,
  priceIdForPlan,
} from "@/lib/billing-stripe.server";

async function assertPlatformOwner(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("is_platform_owner", { _user_id: userId });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Unauthorized");
}

export type BillingOverview = {
  stripeConfigured: boolean;
  checkoutConfigured: boolean;
  platform: {
    plan: BillingPlan;
    source: "manual" | "stripe" | null;
    status: string;
    currentPeriodEnd: string | null;
  };
  companies: Array<{
    companyId: string;
    plan: BillingPlan;
    storedPlan: BillingPlan;
    source: "manual" | "stripe" | null;
    status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
    graceUntil: string | null;
    trialEndsAt: string | null;
    isTrialActive: boolean;
    usage: { employees: number; branches: number };
  }>;
  payments: Awaited<ReturnType<typeof listRecentPayments>>;
  entitlements: BillingAiEntitlement[];
  grants: BillingAiGrantSlice[];
  storageEntitlements: BillingStorageEntitlement[];
  storageGrants: BillingStorageGrantSlice[];
  planEntitlements: PlanEntitlementRow[];
};

function emptyPlatform(): BillingOverview["platform"] {
  return { plan: "free", source: null, status: "none", currentPeriodEnd: null };
}

async function accountToCompanySlice(row: BillingAccountRow) {
  const state = await getCompanyBillingState(row.company_id as string);
  return {
    companyId: row.company_id as string,
    plan: state.effectivePlan,
    storedPlan: row.plan,
    source: row.source,
    status: state.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    graceUntil: row.grace_until,
    trialEndsAt: state.trialEndsAt,
    isTrialActive: state.isTrialActive,
    usage: state.usage,
  };
}

export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingOverview> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const [platform, accounts, payments, entitlements, grants, storageEntitlements, storageGrants, planEntitlements] =
      await Promise.all([
        loadPlatformAccount(),
        listBillingAccounts(),
        listRecentPayments(15),
        listBillingAiEntitlements(),
        listBillingAiGrants(),
        listBillingStorageEntitlements(),
        listBillingStorageGrants(),
        listPlanEntitlements(),
      ]);
    const companyRows = accounts.filter((a) => a.company_id);
    const companies = await Promise.all(companyRows.map((row) => accountToCompanySlice(row)));
    return {
      stripeConfigured: isStripeConfigured(),
      checkoutConfigured: isStripeCheckoutConfigured(),
      platform: platform
        ? {
            plan: effectivePlan(platform),
            source: platform.source,
            status: platform.status,
            currentPeriodEnd: platform.current_period_end,
          }
        : emptyPlatform(),
      companies,
      payments,
      entitlements,
      grants,
      storageEntitlements,
      storageGrants,
      planEntitlements,
    };
  });

const trialInput = z.object({
  companyId: z.string().uuid(),
  days: z.number().int().min(1).max(30).optional(),
});

export const startBillingTrial = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => trialInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const result = await startCompanyTrial({
      companyId: data.companyId,
      days: data.days,
      updatedBy: userId,
    });
    return { ok: true, trialEndsAt: result.trialEndsAt };
  });

export type { CompanyBillingState, PlanEntitlementRow };

const planInput = z.object({
  companyId: z.string().uuid().nullable(),
  plan: z.enum(["free", "standard", "enterprise"]),
});

export const setManualBillingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => planInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const row = await upsertManualPlan({
      companyId: data.companyId,
      plan: data.plan,
      updatedBy: userId,
    });
    if (data.companyId) {
      try {
        await applyCompanyAiGrantFromBillingPlan({
          companyId: data.companyId,
          plan: data.plan,
          grantedBy: userId,
          resetUsage: true,
        });
      } catch {
        // Plan is already durable; AI tables may be missing or out of date.
      }
      try {
        await applyCompanyStorageFromBillingPlan({
          companyId: data.companyId,
          plan: data.plan,
          grantedBy: userId,
        });
      } catch {
        // Storage tables may not be installed yet.
      }
    }
    return { ok: true, plan: row.plan };
  });

const allocationInput = z.object({
  companyId: z.string().uuid(),
  /** Platform assignment id (`company_branch_assignments.id`) — same id AI grants use. */
  branchId: z.string().uuid().nullable(),
  plan: z.enum(["free", "standard", "enterprise"]),
  quotaMinutes: z.number().int().min(0).nullable(),
  useCatalogMinutes: z.boolean(),
  aiEnabled: z.boolean(),
  /** MB. `null` = unlimited. Omitted when useCatalogStorage is true. */
  storageQuotaMb: z.number().int().min(0).nullable(),
  useCatalogStorage: z.boolean(),
});

export const saveBillingAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => allocationInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    await assertPlatformOwner((context as { supabase: any }).supabase, userId);

    if (data.branchId) {
      const { data: assignment, error } = await (supabaseAdmin as any)
        .from("company_branch_assignments")
        .select("id, company_id")
        .eq("id", data.branchId)
        .is("deleted_at", null)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!assignment || assignment.company_id !== data.companyId) {
        throw new Error(billingErrorCode("branchNotInCompany"));
      }
    } else {
      await upsertManualPlan({
        companyId: data.companyId,
        plan: data.plan,
        updatedBy: userId,
      });
    }

    const scopeType = data.branchId ? "branch" : "company";
    const scopeId = data.branchId ?? data.companyId;

    const aiResult = await applyAiGrantFromBillingPlan({
      scopeType,
      scopeId,
      plan: data.plan,
      grantedBy: userId,
      resetUsage: true,
      quotaMinutes: data.useCatalogMinutes ? undefined : data.quotaMinutes,
      isActive: data.aiEnabled,
    });
    if (!aiResult.ok && aiResult.skipped === "planNotFound") {
      throw new Error(billingErrorCode("aiPlanNotFound"));
    }
    if (!aiResult.ok && aiResult.skipped && /missing/i.test(aiResult.skipped)) {
      throw new Error(billingErrorCode("aiTablesMissing"));
    }
    if (!aiResult.ok) {
      throw new Error(aiResult.skipped ?? billingErrorCode("aiSaveFailed"));
    }

    const storageResult = await applyStorageGrantFromBillingPlan({
      scopeType,
      scopeId,
      plan: data.plan,
      grantedBy: userId,
      storageQuotaMb: data.useCatalogStorage ? undefined : data.storageQuotaMb,
      isActive: true,
    });
    if (!storageResult.ok && storageResult.skipped === "planNotFound") {
      throw new Error(billingErrorCode("storagePlanNotFound"));
    }
    if (!storageResult.ok && storageResult.skipped && /missing/i.test(storageResult.skipped)) {
      throw new Error(billingErrorCode("storageTablesMissing"));
    }
    if (!storageResult.ok) {
      throw new Error(storageResult.skipped ?? billingErrorCode("storageSaveFailed"));
    }

    return { ok: true };
  });

const checkoutInput = z.object({
  companyId: z.string().uuid(),
  plan: z.enum(["standard", "enterprise"]),
});

export const createBillingCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => checkoutInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const stripe = getStripe();
    const priceId = priceIdForPlan(data.plan);
    if (!stripe || !priceId) {
      throw new Error(billingErrorCode("stripeNotConfiguredCheckout"));
    }

    const { data: company, error: companyErr } = await (supabaseAdmin as any)
      .from("companies")
      .select("id, name")
      .eq("id", data.companyId)
      .maybeSingle();
    if (companyErr) throw new Error(companyErr.message);
    if (!company) throw new Error(billingErrorCode("companyNotFound"));

    const { data: existing } = await (supabaseAdmin as any)
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("company_id", data.companyId)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id as string | undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: company.name,
        metadata: { company_id: data.companyId },
      });
      customerId = customer.id;
      await saveStripeCustomerId(data.companyId, customerId);
    }

    const request = getRequest();
    const base = appPublicUrl(request);
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: data.companyId,
      locale: "he",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/platform/billing?checkout=success`,
      cancel_url: `${base}/platform/billing?checkout=cancel`,
      metadata: { company_id: data.companyId, plan: data.plan },
      subscription_data: {
        metadata: { company_id: data.companyId, plan: data.plan },
      },
      allow_promotion_codes: true,
    });
    if (!session.url) throw new Error(billingErrorCode("stripeNoCheckoutUrl"));
    return { url: session.url };
  });

const portalInput = z.object({ companyId: z.string().uuid() });

export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => portalInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const stripe = getStripe();
    if (!stripe) throw new Error(billingErrorCode("stripeNotConfigured"));

    const { data: row } = await (supabaseAdmin as any)
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("company_id", data.companyId)
      .maybeSingle();
    const customerId = row?.stripe_customer_id as string | undefined;
    if (!customerId) throw new Error(billingErrorCode("noStripeCustomer"));

    const request = getRequest();
    const base = appPublicUrl(request);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/platform/billing`,
    });
    return { url: session.url };
  });
