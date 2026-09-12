
/** Stripe price ids are `price_…`; tolerate a doubled `price_price_` from env typos. */
export function normalizeStripePriceId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let v = raw.trim();
  while (v.startsWith("price_price_")) v = v.slice("price_".length);
  if (v.length > 40 && v.length % 2 === 0) {
    const half = v.length / 2;
    if (v.slice(0, half) === v.slice(half)) v = v.slice(0, half);
  }
  return v || undefined;
}
/** Server-only Stripe helpers. Never import from client components. */

import Stripe from "stripe";
import type { BillingPlan } from "@/core/managers/billing-manager";
import { readServerEnv } from "@/integrations/supabase/server-dotenv.server";

export type StripeEnvPresence = {
  secretKey: boolean;
  webhookSecret: boolean;
  priceStandard: boolean;
  priceEnterprise: boolean;
  appPublicUrl: boolean;
};

export function getStripeSecretKey(): string | undefined {
  return readServerEnv("STRIPE_SECRET_KEY")?.trim() || undefined;
}

export function getStripeWebhookSecret(): string | undefined {
  return readServerEnv("STRIPE_WEBHOOK_SECRET")?.trim() || undefined;
}

export function getStripePriceStandard(): string | undefined {
  return normalizeStripePriceId(readServerEnv("STRIPE_PRICE_STANDARD"));
}

export function getStripePriceEnterprise(): string | undefined {
  return normalizeStripePriceId(readServerEnv("STRIPE_PRICE_ENTERPRISE"));
}

/** Booleans only — never return secret values to the client. */
export function getStripeEnvPresence(): StripeEnvPresence {
  return {
    secretKey: !!getStripeSecretKey(),
    webhookSecret: !!getStripeWebhookSecret(),
    priceStandard: !!getStripePriceStandard(),
    priceEnterprise: !!getStripePriceEnterprise(),
    appPublicUrl: !!(
      readServerEnv("APP_PUBLIC_URL")?.trim() ||
      process.env.APP_PUBLIC_URL?.trim() ||
      process.env.VITE_APP_URL?.trim() ||
      process.env.NEXT_PUBLIC_URL?.trim()
    ),
  };
}

export function isStripeConfigured(): boolean {
  return !!getStripeSecretKey();
}

export function isStripeWebhookConfigured(): boolean {
  return !!(getStripeSecretKey() && getStripeWebhookSecret());
}

export function isStripeCheckoutConfigured(): boolean {
  return !!(getStripeSecretKey() && (getStripePriceStandard() || getStripePriceEnterprise()));
}

export function missingStripeEnvKeys(): string[] {
  const p = getStripeEnvPresence();
  const missing: string[] = [];
  if (!p.secretKey) missing.push("STRIPE_SECRET_KEY");
  if (!p.webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!p.priceStandard) missing.push("STRIPE_PRICE_STANDARD");
  if (!p.priceEnterprise) missing.push("STRIPE_PRICE_ENTERPRISE");
  return missing;
}

let stripeClient: Stripe | null | undefined;

export function getStripe(): Stripe | null {
  if (stripeClient !== undefined) return stripeClient;
  const key = getStripeSecretKey();
  stripeClient = key ? new Stripe(key) : null;
  return stripeClient;
}

export function priceIdForPlan(plan: Exclude<BillingPlan, "free">): string | null {
  if (plan === "standard") return getStripePriceStandard() ?? null;
  if (plan === "enterprise") return getStripePriceEnterprise() ?? null;
  return null;
}

export function planFromPriceId(priceId: string | null | undefined): BillingPlan | null {
  if (!priceId) return null;
  if (priceId === getStripePriceStandard()) return "standard";
  if (priceId === getStripePriceEnterprise()) return "enterprise";
  return null;
}

export function appPublicUrl(request?: Request | null): string {
  const fromEnv =
    readServerEnv("APP_PUBLIC_URL")?.trim() ||
    process.env.APP_PUBLIC_URL?.trim() ||
    process.env.VITE_APP_URL?.trim() ||
    process.env.NEXT_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const origin = request?.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return "http://localhost:8080";
}

export function mapStripeSubscriptionStatus(status: Stripe.Subscription.Status | string): string {
  const allowed = new Set([
    "active",
    "trialing",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ]);
  return allowed.has(status) ? status : "none";
}

export function subscriptionPriceId(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const price = item?.price;
  if (!price) return null;
  return typeof price === "string" ? price : price.id;
}

export function subscriptionPeriodEnd(sub: Stripe.Subscription): string | null {
  const fromItem = sub.items?.data?.[0]?.current_period_end;
  if (fromItem) return new Date(fromItem * 1000).toISOString();
  return null;
}

export function invoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const sub = invoice.parent?.subscription_details?.subscription;
  if (!sub) return null;
  return typeof sub === "string" ? sub : sub.id;
}
