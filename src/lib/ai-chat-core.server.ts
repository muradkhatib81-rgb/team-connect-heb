import type { AiAssistantKind, AiGrantSource, AiProviderCode, ResolvedAiAccess } from "@/modules/ai";
import type { UUID } from "@/core";
import {
  aiLanguageLabel,
  detectMessageLanguage,
  normalizeAiLocale,
  type AiReplyLanguage,
} from "@/lib/ai-language";
import { applyBetaAiKillSwitch, isHardAiDenial, resolveAiAccessForUi } from "@/lib/ai-access-resolve";
import { loadPlatformFeatureFlagState } from "@/lib/platform-feature-flags.server";

export type RawAiAccess = {
  allowed?: boolean;
  reason?: string;
  assistant_kind?: AiAssistantKind;
  provider_code?: AiProviderCode;
  grant_id?: string | null;
  remaining_minutes?: number | null;
  quota_minutes?: number | null;
  grant_source?: AiGrantSource | "platform" | null;
};

export function mapAiAccess(raw: RawAiAccess): ResolvedAiAccess {
  return {
    allowed: !!raw.allowed,
    grantId: (raw.grant_id as UUID | null | undefined) ?? null,
    providerCode: raw.provider_code ?? "gemini",
    assistantKind: raw.assistant_kind ?? "employee",
    remainingMinutes: raw.remaining_minutes ?? null,
    quotaMinutes: raw.quota_minutes ?? null,
    grantSource: (raw.grant_source as AiGrantSource | null) ?? null,
    reason: raw.reason ?? null,
  };
}

/**
 * Resolve AI access using the existing `get_my_ai_access` RPC, then expose the
 * owner allow path via `is_platform_owner(userId)` when the RPC denied for a
 * non-hard reason (typically `auth.uid()` empty / no branch on platform home).
 */
export async function loadResolvedAiAccess(supabase: any, userId: string): Promise<ResolvedAiAccess> {
  const flags = await loadPlatformFeatureFlagState();
  if (!flags["platform.beta_ai"]) {
    const { data: isOwner, error: ownerErr } = await supabase.rpc("is_platform_owner", {
      _user_id: userId,
    });
    if (ownerErr) throw new Error(ownerErr.message);
    if (!isOwner) {
      return applyBetaAiKillSwitch(mapAiAccess({}), {
        betaAiEnabled: false,
        isPlatformOwner: false,
      });
    }
  }

  const { data, error } = await supabase.rpc("get_my_ai_access");
  if (error) throw new Error(error.message);
  const mapped = mapAiAccess((data ?? {}) as RawAiAccess);
  if (mapped.allowed || isHardAiDenial(mapped.reason)) return mapped;

  const { data: isOwner, error: ownerErr } = await supabase.rpc("is_platform_owner", {
    _user_id: userId,
  });
  if (ownerErr) throw new Error(ownerErr.message);
  if (isOwner) return resolveAiAccessForUi(mapped, true);
  return mapped;
}

export function buildAiSystemPrompt(
  kind: AiAssistantKind,
  replyLanguage: AiReplyLanguage,
): string {
  const lang = aiLanguageLabel(replyLanguage);
  const languageRule = `Always reply in ${lang}. Match the language of the user's latest message. Keep answers concise (2–4 sentences) unless they ask for detail.`;
  if (kind === "platform_owner") {
    return `You are a platform operations assistant for a workforce management SaaS. ${languageRule} Help with platform overview, companies, branches, department heads, employee job titles, employee leave balances (regular/sick days), employee of the month, system issues/errors, platform owners, AI grants and usage, billing/quota links, health checks, audit events, and settings. Use ONLY the live data snapshot when answering factual questions — never invent numbers, dates, names, counts, or phone numbers. For managers/roles use managementDirectory (includes branch_manager, assistant_manager, department_manager even if excludedFromHeadcount; each entry may include phone). Also use branchDirectories.departmentsDirectory.headPhone for department-head phones. For newest staff use recentHires (createdAt). For who is on break now use activeBreaksNow. For recently published schedules use recentPublishedSchedules (approved + published_at). For errors/problems: use operationalIssues — each issue has severity, scope (platform/infrastructure/company/branch/department), companyName, branchName, departmentName, component, and message. Also use health.checks for infrastructure status. For branch-specific questions, use branchDirectories. If a fact is missing from the snapshot, say you do not have that data/permission — never invent it. HARD RULE: READ-ONLY advisor. Never approve, reject, create, update, or delete leave, breaks, schedules, permissions, or grants. If the user asks you to take an action, refuse politely and point them to the relevant UI screen.`;
  }
  if (kind === "manager") {
    return `You are a branch/department manager assistant for a workforce app. ${languageRule} Help summarize operational questions within YOUR permission scope only (schedules, leaves, breaks, team status, tasks, department heads, department rosters, employee leave balances, employee phone numbers, employee of the month). Use ONLY the live data snapshot when answering factual questions — never invent numbers, dates, names, phone numbers, or employee counts. Snapshot fields are already filtered by role and owner-granted permissions: branch_manager/assistant_manager see branch data only when grants allow (see grants.*); department_manager (department_head) is limited to THEIR department (scope=department_only) — never answer cross-department or other-branch questions. When present, use managementDirectory for managers/heads (includes excludedFromHeadcount managers and phone when granted), recentHires for newest staff in scope, activeBreaksNow / breaksToday.activeNow / headcount.today.onBreakNames for who is on break, and recentPublishedSchedules / scheduleLastModified for published schedules. For department questions, use departmentsDirectory when present. For employee-of-the-month questions, use employeeOfMonth when present. If a field is missing from the snapshot, say you do not have permission or data and point to the relevant UI screen — do not guess from outside knowledge. HARD RULE: READ-ONLY advisor. Never approve, reject, create, update, or delete leave, breaks, schedules, or permissions. If asked to take an action, refuse politely and name the screen to use.`;
  }
  return `You are an employee self-service assistant for a workforce app. ${languageRule} Help ONLY with the signed-in user's own leave balance, schedule, breaks, and profile. Use ONLY the live data snapshot when answering factual questions — never invent numbers, dates, or names. You do NOT have access to other employees, managers lists, recent hires, who is on break, or published schedules for others — if asked, say you do not have permission and point them to their manager or the relevant screen. HARD RULE: READ-ONLY. Never approve, reject, create, or update anything. If asked to take an action, refuse politely and guide them to the UI screen.`;
}

export function appendAiContextToSystemPrompt(systemPrompt: string, contextBlock: string | null | undefined): string {
  if (!contextBlock?.trim()) return systemPrompt;
  return `${systemPrompt}

Live data snapshot (authoritative — use ONLY this for factual answers about this user):
${contextBlock}`;
}

export function resolveAiReplyLanguage(message: string, locale?: string | null): AiReplyLanguage {
  return detectMessageLanguage(message, normalizeAiLocale(locale));
}

export function estimateAiMinutes(
  durationMs: number,
  inputTokens: number,
  outputTokens: number,
): number {
  const fromDuration = durationMs / 60_000;
  const fromTokens = (inputTokens + outputTokens) / 1000;
  return Math.max(0.01, Math.round(Math.max(fromDuration, fromTokens * 0.02) * 100) / 100);
}

export type AiChatHistoryMessage = { role: "user" | "assistant"; content: string };

export function buildAiChatMessages(input: {
  assistantKind: AiAssistantKind;
  message: string;
  history?: AiChatHistoryMessage[];
  locale?: string | null;
  contextBlock?: string | null;
}) {
  const replyLanguage = resolveAiReplyLanguage(input.message, input.locale);
  const systemPrompt = appendAiContextToSystemPrompt(
    buildAiSystemPrompt(input.assistantKind, replyLanguage),
    input.contextBlock,
  );
  return [
    { role: "system" as const, content: systemPrompt },
    ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user" as const, content: input.message },
  ];
}
