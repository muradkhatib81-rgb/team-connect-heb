/**
 * Persist Stripe / manual billing state. Service-role only.
 * Does not read or write user_roles / user_task_permissions.
 */

import type Stripe from "stripe";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { BillingPlan } from "@/core/managers/billing-manager";
import { applyCompanyAiGrantFromBillingPlan } from "@/lib/billing-ai-sync.server";
import { applyCompanyStorageFromBillingPlan } from "@/lib/billing-storage.server";
import {
  invoiceSubscriptionId,
  mapStripeSubscriptionStatus,
  planFromPriceId,
  subscriptionPeriodEnd,
  subscriptionPriceId,
} from "@/lib/billing-stripe.server";

const GRACE_MS = 3 * 24 * 60 * 60 * 1000;

export type BillingAccountRow = {
  id: string;
  company_id: string | null;
  plan: BillingPlan;
  source: "manual" | "stripe";
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  grace_until: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export function effectivePlan(row: Pick<BillingAccountRow, "plan" | "status" | "grace_until">): BillingPlan {
  if (row.status === "canceled" || row.status === "unpaid" || row.status === "incomplete_expired") {
    return "free";
  }
  if (row.status === "past_due" && row.grace_until && new Date(row.grace_until).getTime() < Date.now()) {
    return "free";
  }
  return row.plan;
}

async function loadByCompanyId(companyId: string): Promise<BillingAccountRow | null> {
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

async function loadByCustomerId(customerId: string): Promise<BillingAccountRow | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .select("*")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BillingAccountRow | null) ?? null;
}

async function loadBySubscriptionId(subscriptionId: string): Promise<BillingAccountRow | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .select("*")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as BillingAccountRow | null) ?? null;
}

export async function upsertManualPlan(opts: {
  companyId: string | null;
  plan: BillingPlan;
  updatedBy: string;
}): Promise<BillingAccountRow> {
  const now = new Date().toISOString();
  const existing = opts.companyId
    ? await loadByCompanyId(opts.companyId)
    : await loadPlatformAccount();

  const payload = {
    company_id: opts.companyId,
    plan: opts.plan,
    source: "manual" as const,
    status: "active",
    grace_until: null,
    updated_by: opts.updatedBy,
    updated_at: now,
  };

  if (existing?.id) {
    const { data, error } = await (supabaseAdmin as any)
      .from("billing_accounts")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw new Error(billingDbError(error.message));
    return data as BillingAccountRow;
  }

  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .insert({ ...payload, created_at: now })
    .select("*")
    .single();
  if (error) throw new Error(billingDbError(error.message));
  return data as BillingAccountRow;
}

function billingDbError(message: string): string {
  if (/does not exist|relation/i.test(message)) {
    return "טבלת החיוב עדיין לא הותקנה במסד. הריצו את המיגרציה 20260825120000_billing_stripe_foundation.sql";
  }
  return message;
}

export async function loadPlatformAccount(): Promise<BillingAccountRow | null> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .select("*")
    .is("company_id", null)
    .maybeSingle();
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return null;
    throw new Error(error.message);
  }
  return (data as BillingAccountRow | null) ?? null;
}

export async function listBillingAccounts(): Promise<BillingAccountRow[]> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_accounts")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return (data ?? []) as BillingAccountRow[];
}

export async function listRecentPayments(limit = 20): Promise<
  {
    id: string;
    company_id: string | null;
    amount_cents: number | null;
    currency: string | null;
    status: string;
    paid_at: string | null;
    hosted_invoice_url: string | null;
    created_at: string;
  }[]
> {
  const { data, error } = await (supabaseAdmin as any)
    .from("billing_payments")
    .select("id, company_id, amount_cents, currency, status, paid_at, hosted_invoice_url, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    if (/does not exist|relation/i.test(error.message)) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

export async function saveStripeCustomerId(companyId: string, stripeCustomerId: string): Promise<void> {
  const existing = await loadByCompanyId(companyId);
  const now = new Date().toISOString();
  if (existing?.id) {
    const { error } = await (supabaseAdmin as any)
      .from("billing_accounts")
      .update({ stripe_customer_id: stripeCustomerId, updated_at: now })
      .eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await (supabaseAdmin as any).from("billing_accounts").insert({
    company_id: companyId,
    plan: "free",
    source: "manual",
    status: "none",
    stripe_customer_id: stripeCustomerId,
    updated_at: now,
  });
  if (error) throw new Error(error.message);
}

async function applySubscriptionToCompany(
  companyId: string,
  sub: Stripe.Subscription,
  source: "stripe" | "manual" = "stripe",
): Promise<void> {
  const priceId = subscriptionPriceId(sub);
  const plan = planFromPriceId(priceId) ?? (sub.status === "canceled" ? "free" : null);
  const resolvedPlan: BillingPlan = plan ?? "free";
  const previous = await loadByCompanyId(companyId);
  const now = new Date().toISOString();
  const status = mapStripeSubscriptionStatus(sub.status);

  const payload = {
    company_id: companyId,
    plan: resolvedPlan,
    source,
    status,
    stripe_customer_id: typeof sub.customer === "string" ? sub.customer : sub.customer?.id ?? previous?.stripe_customer_id ?? null,
    stripe_subscription_id: sub.id,
    stripe_price_id: priceId,
    current_period_end: subscriptionPeriodEnd(sub),
    cancel_at_period_end: !!sub.cancel_at_period_end,
    grace_until: status === "past_due" ? previous?.grace_until ?? null : null,
    updated_at: now,
  };

  if (previous?.id) {
    const { error } = await (supabaseAdmin as any).from("billing_accounts").update(payload).eq("id", previous.id);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await (supabaseAdmin as any).from("billing_accounts").insert(payload);
    if (error) throw new Error(error.message);
  }

  const nextPlan = effectivePlan({ plan: resolvedPlan, status, grace_until: payload.grace_until });
  await applyCompanyAiGrantFromBillingPlan({
    companyId,
    plan: nextPlan,
    resetUsage: previous?.plan !== nextPlan,
  });
  await applyCompanyStorageFromBillingPlan({
    companyId,
    plan: nextPlan,
  });
}

async function resolveCompanyIdFromStripe(opts: {
  customerId?: string | null;
  subscriptionId?: string | null;
  metadataCompanyId?: string | null;
}): Promise<string | null> {
  if (opts.metadataCompanyId) return opts.metadataCompanyId;
  if (opts.subscriptionId) {
    const bySub = await loadBySubscriptionId(opts.subscriptionId);
    if (bySub?.company_id) return bySub.company_id;
  }
  if (opts.customerId) {
    const byCust = await loadByCustomerId(opts.customerId);
    if (byCust?.company_id) return byCust.company_id;
  }
  return null;
}

async function recordInvoice(invoice: Stripe.Invoice, companyId: string | null): Promise<void> {
  const paid = invoice.status === "paid";
  const paidAtUnix = invoice.status_transitions?.paid_at;
  const payload = {
    company_id: companyId,
    stripe_invoice_id: invoice.id,
    stripe_payment_intent_id: null as string | null,
    amount_cents: invoice.amount_paid ?? invoice.amount_due ?? null,
    currency: invoice.currency ?? null,
    status: invoice.status ?? "open",
    paid_at: paid && paidAtUnix ? new Date(paidAtUnix * 1000).toISOString() : paid ? new Date().toISOString() : null,
    hosted_invoice_url: invoice.hosted_invoice_url ?? null,
    receipt_url: null as string | null,
  };

  const { data: existing } = await (supabaseAdmin as any)
    .from("billing_payments")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();
  if (existing?.id) {
    const { error } = await (supabaseAdmin as any).from("billing_payments").update(payload).eq("id", existing.id);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await (supabaseAdmin as any).from("billing_payments").insert(payload);
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
}

export async function processStripeEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const companyId =
        (session.metadata?.company_id as string | undefined) ||
        (session.client_reference_id as string | undefined) ||
        null;
      const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
      if (companyId && customerId) {
        await saveStripeCustomerId(companyId, customerId);
      }
      const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
      if (companyId && subId) {
        const stripeMod = await import("@/lib/billing-stripe.server");
        const stripe = stripeMod.getStripe();
        if (stripe) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscriptionToCompany(companyId, sub, "stripe");
        }
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
      const companyId = await resolveCompanyIdFromStripe({
        customerId,
        subscriptionId: sub.id,
        metadataCompanyId: (sub.metadata?.company_id as string | undefined) ?? null,
      });
      if (!companyId) break;
      if (event.type === "customer.subscription.deleted") {
        const previous = await loadByCompanyId(companyId);
        const now = new Date().toISOString();
        const payload = {
          plan: "free" as const,
          source: "stripe" as const,
          status: "canceled",
          stripe_subscription_id: null,
          stripe_price_id: null,
          cancel_at_period_end: false,
          grace_until: null,
          updated_at: now,
        };
        if (previous?.id) {
          await (supabaseAdmin as any).from("billing_accounts").update(payload).eq("id", previous.id);
        }
        await applyCompanyAiGrantFromBillingPlan({ companyId, plan: "free", resetUsage: true });
        await applyCompanyStorageFromBillingPlan({ companyId, plan: "free" });
      } else {
        await applySubscriptionToCompany(companyId, sub, "stripe");
      }
      break;
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id;
      const subId = invoiceSubscriptionId(invoice);
      const companyId = await resolveCompanyIdFromStripe({
        customerId,
        subscriptionId: subId ?? null,
        metadataCompanyId: (invoice.metadata?.company_id as string | undefined) ?? null,
      });
      await recordInvoice(invoice, companyId);
      if (!companyId) break;
      const previous = await loadByCompanyId(companyId);
      if (!previous?.id) break;
      if (event.type === "invoice.paid") {
        await (supabaseAdmin as any)
          .from("billing_accounts")
          .update({
            status: "active",
            grace_until: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", previous.id);
        await applyCompanyAiGrantFromBillingPlan({
          companyId,
          plan: previous.plan,
          resetUsage: false,
        });
        await applyCompanyStorageFromBillingPlan({
          companyId,
          plan: previous.plan,
        });
      } else {
        const graceUntil = new Date(Date.now() + GRACE_MS).toISOString();
        await (supabaseAdmin as any)
          .from("billing_accounts")
          .update({
            status: "past_due",
            grace_until: previous.grace_until ?? graceUntil,
            updated_at: new Date().toISOString(),
          })
          .eq("id", previous.id);
      }
      break;
    }
    default:
      break;
  }
}

export async function beginWebhookEvent(eventId: string, eventType: string): Promise<"process" | "skip"> {
  const { data: existing } = await (supabaseAdmin as any)
    .from("billing_webhook_events")
    .select("stripe_event_id, processed_at")
    .eq("stripe_event_id", eventId)
    .maybeSingle();
  if (existing?.processed_at) return "skip";
  if (!existing) {
    const { error } = await (supabaseAdmin as any).from("billing_webhook_events").insert({
      stripe_event_id: eventId,
      event_type: eventType,
    });
    if (error && /duplicate|unique/i.test(error.message)) {
      const { data: again } = await (supabaseAdmin as any)
        .from("billing_webhook_events")
        .select("processed_at")
        .eq("stripe_event_id", eventId)
        .maybeSingle();
      if (again?.processed_at) return "skip";
    } else if (error) {
      throw new Error(error.message);
    }
  }
  return "process";
}

export async function finishWebhookEvent(eventId: string, errorText?: string): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from("billing_webhook_events")
    .update({
      processed_at: errorText ? null : new Date().toISOString(),
      error_text: errorText ?? null,
    })
    .eq("stripe_event_id", eventId);
  if (error) throw new Error(error.message);
}
