/**
 * AI Assistant module — provider-agnostic types.
 *
 * Platform -> Companies -> Branches -> Users
 * Grants and usage are platform-owner controlled; see docs/architecture/09-ai-assistant-design.md
 */

import type { BillingPlan } from "@/core/managers/billing-manager";
import type { UUID } from "@/core";

/** Supported provider codes — extend without schema migration (text column). */
export type AiProviderCode = "gemini" | "openai" | "anthropic" | (string & {});

export type AiGrantScopeType = "company" | "branch" | "user";

/** How the grant was created — links manual vs billing automation. */
export type AiGrantSource =
  | "manual_free"
  | "manual_paid"
  | "billing_plan";

export type AiQuotaPeriod = "monthly" | "lifetime";

export type AiAssistantKind = "employee" | "manager" | "platform_owner";

export interface AiProvider {
  code: AiProviderCode;
  displayName: string;
  defaultModel: string;
  isEnabled: boolean;
  sortOrder: number;
}

export interface AiPlanEntitlement {
  billingPlan: BillingPlan;
  monthlyMinutes: number | null;
  defaultProviderCode: AiProviderCode;
  allowsProviderChoice: boolean;
}

export interface AiGrant {
  id: UUID;
  scopeType: AiGrantScopeType;
  scopeId: UUID;
  providerCode: AiProviderCode | null;
  grantSource: AiGrantSource;
  billingPlan: BillingPlan | null;
  quotaMinutes: number | null;
  quotaPeriod: AiQuotaPeriod;
  usedMinutes: number;
  periodStartedAt: Date;
  isActive: boolean;
  notes: string | null;
  grantedBy: UUID | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiAdminDelegate {
  userId: UUID;
  canManageGrants: boolean;
  canManageProviders: boolean;
  canViewUsage: boolean;
  grantedBy: UUID;
  createdAt: Date;
}

export interface AiUsageEvent {
  id: UUID;
  grantId: UUID | null;
  userId: UUID;
  companyId: UUID | null;
  branchAssignmentId: UUID | null;
  providerCode: AiProviderCode;
  model: string;
  assistantKind: AiAssistantKind;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  createdAt: Date;
}

export interface AiPlatformSettings {
  platformId: UUID;
  defaultProviderCode: AiProviderCode;
  ownerMonthlyMinutes: number | null;
  ownerUsedMinutes: number;
  ownerPeriodStartedAt: Date;
  isGloballyEnabled: boolean;
}

/** Resolved entitlement for the current user session. */
export interface ResolvedAiAccess {
  allowed: boolean;
  grantId: UUID | null;
  providerCode: AiProviderCode;
  assistantKind: AiAssistantKind;
  remainingMinutes: number | null;
  quotaMinutes: number | null;
  grantSource: AiGrantSource | null;
}

export const DEFAULT_AI_PROVIDER: AiProviderCode = "gemini";

/** Fast default for in-app chat (new API keys, minimal thinking by default). */
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

/** Higher-quality model when explicitly configured in admin. */
export const DEFAULT_GEMINI_QUALITY_MODEL = "gemini-3.5-flash";

/** Retired / blocked-for-new-users models still stored in DB/UI are mapped at call time. */
export const DEPRECATED_GEMINI_MODEL_ALIASES: Record<string, string> = {
  "gemini-2.0-flash": DEFAULT_GEMINI_MODEL,
  "gemini-2.0-flash-001": DEFAULT_GEMINI_MODEL,
  "gemini-2.0-flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-2.0-flash-lite-001": DEFAULT_GEMINI_MODEL,
  "gemini-2.5-flash": DEFAULT_GEMINI_QUALITY_MODEL,
  "gemini-2.5-flash-lite": DEFAULT_GEMINI_MODEL,
  "gemini-2.5-pro": DEFAULT_GEMINI_QUALITY_MODEL,
  "gemini-3.5-flash": DEFAULT_GEMINI_QUALITY_MODEL,
};

export function resolveGeminiModel(model?: string | null): string {
  const requested = model?.trim() || DEFAULT_GEMINI_MODEL;
  return DEPRECATED_GEMINI_MODEL_ALIASES[requested] ?? requested;
}

export const DEFAULT_PLAN_ENTITLEMENTS: AiPlanEntitlement[] = [
  {
    billingPlan: "free",
    monthlyMinutes: 30,
    defaultProviderCode: "gemini",
    allowsProviderChoice: false,
  },
  {
    billingPlan: "standard",
    monthlyMinutes: 300,
    defaultProviderCode: "gemini",
    allowsProviderChoice: false,
  },
  {
    billingPlan: "enterprise",
    monthlyMinutes: null,
    defaultProviderCode: "gemini",
    allowsProviderChoice: true,
  },
];
