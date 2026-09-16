/**
 * Durable customer-billing visibility (platform master + per-company opt-in).
 * Uses service role reads/writes. Does not touch roles or RLS policies.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { companyIdForPhysicalBranch } from "@/lib/billing-entitlements.server";
import {
  resolveCustomerBillingGate,
  type CustomerBillingGate,
} from "@/lib/billing-visibility";

function isMissingRelationOrColumn(message: string): boolean {
  return /does not exist|column|relation/i.test(message);
}

export async function loadPlatformCustomerBillingVisible(): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .select("customer_billing_visible")
    .eq("id", 1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumn(error.message)) return false;
    throw new Error(error.message);
  }
  return data?.customer_billing_visible === true;
}

export async function savePlatformCustomerBillingVisible(visible: boolean): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from("platform_settings")
    .update({ customer_billing_visible: visible })
    .eq("id", 1);
  if (error) throw new Error(error.message);
}

export async function loadCompanyBillingEnabled(companyId: string): Promise<boolean> {
  const { data, error } = await (supabaseAdmin as any)
    .from("companies")
    .select("billing_enabled")
    .eq("id", companyId)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumn(error.message)) return false;
    throw new Error(error.message);
  }
  return data?.billing_enabled === true;
}

export async function saveCompanyBillingEnabled(companyId: string, enabled: boolean): Promise<void> {
  const { error } = await (supabaseAdmin as any)
    .from("companies")
    .update({ billing_enabled: enabled })
    .eq("id", companyId);
  if (error) throw new Error(error.message);
}

export async function resolveCompanyIdForUser(opts: {
  companyId?: string | null;
  branchId?: string | null;
  profileBranchId?: string | null;
}): Promise<string | null> {
  if (opts.companyId) return opts.companyId;
  const branchId = opts.branchId || opts.profileBranchId;
  if (!branchId) return null;
  return companyIdForPhysicalBranch(branchId);
}

export async function loadCustomerBillingGate(opts: {
  isPlatformOwner: boolean;
  companyId?: string | null;
  branchId?: string | null;
  profileBranchId?: string | null;
}): Promise<CustomerBillingGate> {
  const [platformVisible, companyId] = await Promise.all([
    loadPlatformCustomerBillingVisible(),
    resolveCompanyIdForUser(opts),
  ]);
  const companyEnabled = companyId ? await loadCompanyBillingEnabled(companyId) : false;
  return resolveCustomerBillingGate({
    platformVisible,
    companyEnabled,
    companyId,
    isPlatformOwner: opts.isPlatformOwner,
  });
}

/** Server-side hard gate for future non-owner checkout/portal. */
export async function assertCustomerSelfServeEnabled(opts: {
  companyId: string;
  isPlatformOwner: boolean;
}): Promise<void> {
  if (opts.isPlatformOwner) return;
  const gate = await loadCustomerBillingGate({
    isPlatformOwner: false,
    companyId: opts.companyId,
  });
  if (!gate.customerPaymentUiVisible) {
    const { billingErrorCode } = await import("@/lib/billing-errors");
    throw new Error(billingErrorCode("customerUiDisabled"));
  }
}
