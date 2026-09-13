import type { ResolvedAiAccess } from "@/modules/ai";

/** Soft-fail payload when the access RPC errors for a non-owner. */
export const NO_AI_ACCESS: ResolvedAiAccess = {
  allowed: false,
  grantId: null,
  providerCode: "gemini",
  assistantKind: "employee",
  remainingMinutes: null,
  quotaMinutes: null,
  grantSource: null,
  reason: null,
};

/**
 * Existing server allow path for platform owners (no branch / grant required).
 * Used as a client placeholder and as a fallback when the RPC denies for
 * reasons other than an explicit global/quota block.
 */
export const PLATFORM_OWNER_AI_ACCESS: ResolvedAiAccess = {
  allowed: true,
  grantId: null,
  providerCode: "gemini",
  assistantKind: "platform_owner",
  remainingMinutes: null,
  quotaMinutes: null,
  grantSource: null,
  reason: null,
};

export function isHardAiDenial(reason?: string | null): boolean {
  return reason === "globally_disabled" || reason === "quota_exhausted";
}

/**
 * Expose the existing platform-owner allow path without requiring Branch Mode.
 * Employees/managers stay on the server grant result.
 */
export function resolveAiAccessForUi(
  server: ResolvedAiAccess | undefined,
  isOwner: boolean,
): ResolvedAiAccess {
  if (server?.allowed) return server;
  if (isOwner && !isHardAiDenial(server?.reason)) {
    return {
      ...PLATFORM_OWNER_AI_ACCESS,
      remainingMinutes: server?.remainingMinutes ?? null,
      quotaMinutes: server?.quotaMinutes ?? null,
      providerCode: server?.providerCode ?? PLATFORM_OWNER_AI_ACCESS.providerCode,
    };
  }
  return server ?? NO_AI_ACCESS;
}
