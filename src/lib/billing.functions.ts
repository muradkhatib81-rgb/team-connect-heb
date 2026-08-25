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
  }>;
  payments: Awaited<ReturnType<typeof listRecentPayments>>;
  entitlements: BillingAiEntitlement[];
  grants: BillingAiGrantSlice[];
  storageEntitlements: BillingStorageEntitlement[];
  storageGrants: BillingStorageGrantSlice[];
};

function emptyPlatform(): BillingOverview["platform"] {
  return { plan: "free", source: null, status: "none", currentPeriodEnd: null };
}

function accountToCompanySlice(row: BillingAccountRow) {
  return {
    companyId: row.company_id as string,
    plan: effectivePlan(row),
    storedPlan: row.plan,
    source: row.source,
    status: row.status,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    graceUntil: row.grace_until,
  };
}

export const getBillingOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingOverview> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertPlatformOwner(supabase, userId);
    const [platform, accounts, payments, entitlements, grants, storageEntitlements, storageGrants] =
      await Promise.all([
        loadPlatformAccount(),
        listBillingAccounts(),
        listRecentPayments(15),
        listBillingAiEntitlements(),
        listBillingAiGrants(),
        listBillingStorageEntitlements(),
        listBillingStorageGrants(),
      ]);
    const companyRows = accounts.filter((a) => a.company_id);
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
      companies: companyRows.map(accountToCompanySlice),
      payments,
      entitlements,
      grants,
      storageEntitlements,
      storageGrants,
    };
  });

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
        throw new Error("הסניף לא שייך לחברה שנבחרה");
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
      throw new Error("לא נמצאה מכסת דקות לתוכנית זו");
    }
    if (!aiResult.ok && aiResult.skipped && /missing/i.test(aiResult.skipped)) {
      throw new Error("טבלאות ה-AI עדיין לא הותקנו במסד");
    }
    if (!aiResult.ok) {
      throw new Error(aiResult.skipped ?? "שמירת הקצאת ה-AI נכשלה");
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
      throw new Error("לא נמצאה מכסת אחסון לתוכנית זו");
    }
    if (!storageResult.ok && storageResult.skipped && /missing/i.test(storageResult.skipped)) {
      throw new Error(
        "טבלאות האחסון עדיין לא הותקנו במסד. הריצו את המיגרציה 20260825130000_billing_storage_quotas.sql",
      );
    }
    if (!storageResult.ok) {
      throw new Error(storageResult.skipped ?? "שמירת מכסת האחסון נכשלה");
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
      throw new Error("Stripe אינו מוגדר. הוסיפו STRIPE_SECRET_KEY ו-STRIPE_PRICE_STANDARD / STRIPE_PRICE_ENTERPRISE.");
    }

    const { data: company, error: companyErr } = await (supabaseAdmin as any)
      .from("companies")
      .select("id, name")
      .eq("id", data.companyId)
      .maybeSingle();
    if (companyErr) throw new Error(companyErr.message);
    if (!company) throw new Error("החברה לא נמצאה");

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
    if (!session.url) throw new Error("Stripe לא החזיר כתובת תשלום");
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
    if (!stripe) throw new Error("Stripe אינו מוגדר.");

    const { data: row } = await (supabaseAdmin as any)
      .from("billing_accounts")
      .select("stripe_customer_id")
      .eq("company_id", data.companyId)
      .maybeSingle();
    const customerId = row?.stripe_customer_id as string | undefined;
    if (!customerId) throw new Error("אין לקוח Stripe לחברה זו. התחילו בתשלום קודם.");

    const request = getRequest();
    const base = appPublicUrl(request);
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${base}/platform/billing`,
    });
    return { url: session.url };
  });
