/** Shared customer-payment visibility helpers (safe for client + server). */

export const CUSTOMER_PAYMENT_VISIBLE_QUERY_KEY = ["customer-payment-visible"] as const;

export function parseCustomerPaymentVisible(row: unknown): boolean {
  if (!row || typeof row !== "object") return false;
  return (row as { customer_payment_visible?: unknown }).customer_payment_visible === true;
}

/**
 * Customer-facing payment nav/routes (not Platform Owner `/platform/billing`).
 * Fail closed: hidden unless the platform flag is on and the viewer is a
 * non–Platform-Owner company operator (branch/assistant manager).
 */
export function canShowCustomerPaymentUi(opts: {
  customerPaymentVisible: boolean;
  isPlatformOwner: boolean;
  isCompanyOperator: boolean;
}): boolean {
  if (!opts.customerPaymentVisible) return false;
  if (opts.isPlatformOwner) return false;
  return opts.isCompanyOperator;
}

export function isCompanyPaymentOperator(roles: readonly string[]): boolean {
  return roles.some((r) => r === "branch_manager" || r === "assistant_manager");
}
