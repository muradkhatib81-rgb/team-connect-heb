import type { TFunction } from "i18next";

const PREFIX = "BILLING_ERROR:";

export function billingErrorCode(
  key: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  if (!params || Object.keys(params).length === 0) return `${PREFIX}${key}`;
  const q = Object.entries(params)
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `${PREFIX}${key}?${q}` : `${PREFIX}${key}`;
}

export function isBillingErrorCode(message: string): boolean {
  return message.startsWith(PREFIX);
}

export function translateBillingError(message: string, t: TFunction): string {
  if (!isBillingErrorCode(message)) return message;
  const raw = message.slice(PREFIX.length);
  const [key, query = ""] = raw.split("?", 2);
  const params: Record<string, string> = {};
  if (query) {
    for (const part of query.split("&")) {
      const [k, v] = part.split("=", 2);
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? "");
    }
  }
  if (params.plan) {
    params.planLabel = t(`platformBilling.plans.${params.plan}`, {
      defaultValue: params.plan,
    });
  }
  return t(`platformBilling.errors.${key}`, {
    ...params,
    defaultValue: message,
  });
}
