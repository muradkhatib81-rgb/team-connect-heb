/**
 * Customer payment UI gate.
 *
 * Two durable flags, both default OFF:
 * 1. Platform master (`platform_settings.customer_billing_visible`) — one
 *    Platform Owner switch. OFF hides payment/checkout/self-serve for everyone
 *    except the owner, who always keeps `/platform/billing`.
 * 2. Per-company (`companies.billing_enabled`) — opt-in that only applies when
 *    the master switch is ON.
 *
 * Manual plan activation, entitlements, AI minutes, and storage are not gated.
 */

export const CUSTOMER_BILLING_GATE_QUERY_KEY = ["customer-billing-gate"] as const;

export type CustomerBillingGate = {
  /** Platform Owner master toggle. */
  platformVisible: boolean;
  /** Per-company opt-in. False when no company could be resolved. */
  companyEnabled: boolean;
  companyId: string | null;
  /** True only when both flags are on — customer payment UI may render. */
  customerPaymentUiVisible: boolean;
  isPlatformOwner: boolean;
};

export function emptyCustomerBillingGate(
  partial?: Partial<CustomerBillingGate>,
): CustomerBillingGate {
  return {
    platformVisible: false,
    companyEnabled: false,
    companyId: null,
    customerPaymentUiVisible: false,
    isPlatformOwner: false,
    ...partial,
  };
}

/** Customer-facing payment/checkout/subscription self-serve. */
export function isCustomerPaymentUiVisible(input: {
  platformVisible: boolean;
  companyEnabled: boolean;
}): boolean {
  return input.platformVisible === true && input.companyEnabled === true;
}

export function resolveCustomerBillingGate(input: {
  platformVisible: boolean;
  companyEnabled: boolean;
  companyId: string | null;
  isPlatformOwner: boolean;
}): CustomerBillingGate {
  return {
    platformVisible: input.platformVisible === true,
    companyEnabled: input.companyEnabled === true,
    companyId: input.companyId,
    customerPaymentUiVisible: isCustomerPaymentUiVisible(input),
    isPlatformOwner: input.isPlatformOwner === true,
  };
}

/**
 * Who may see customer payment nav / self-serve.
 * Platform Owners never use this path — they have `/platform/billing`.
 */
export function canSeeCustomerPaymentNav(input: {
  isPlatformOwner: boolean;
  isBranchManager: boolean;
  canManageCompanySettings: boolean;
  customerPaymentUiVisible: boolean;
}): boolean {
  if (input.isPlatformOwner) return false;
  if (!input.customerPaymentUiVisible) return false;
  return input.isBranchManager || input.canManageCompanySettings;
}
