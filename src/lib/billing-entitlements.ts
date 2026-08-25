/** Plan limits catalog — safe for client + server (fallback when DB missing). */

import type { BillingPlan } from "@/core/managers/billing-manager";

export const DEFAULT_TRIAL_DAYS = 7;

export type PlanEntitlementRow = {
  billing_plan: BillingPlan;
  max_employees: number | null;
  max_branches: number | null;
  realtime_enabled: boolean;
  analytics_enabled: boolean;
  default_trial_days: number;
};

export const DEFAULT_PLAN_ENTITLEMENTS: Record<BillingPlan, PlanEntitlementRow> = {
  free: {
    billing_plan: "free",
    max_employees: 15,
    max_branches: 1,
    realtime_enabled: false,
    analytics_enabled: false,
    default_trial_days: 0,
  },
  standard: {
    billing_plan: "standard",
    max_employees: 150,
    max_branches: 5,
    realtime_enabled: true,
    analytics_enabled: true,
    default_trial_days: DEFAULT_TRIAL_DAYS,
  },
  enterprise: {
    billing_plan: "enterprise",
    max_employees: null,
    max_branches: null,
    realtime_enabled: true,
    analytics_enabled: true,
    default_trial_days: 0,
  },
};

export function formatLimit(
  value: number | null | undefined,
  unit: string,
  unlimitedLabel = "∞",
): string {
  if (value == null) return unlimitedLabel;
  return `${value} ${unit}`;
}

export function trialDaysRemaining(trialEndsAt: string | null | undefined, now = Date.now()): number | null {
  if (!trialEndsAt) return null;
  const ms = new Date(trialEndsAt).getTime() - now;
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}
