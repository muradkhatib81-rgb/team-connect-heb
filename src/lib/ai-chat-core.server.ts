import type { AiAssistantKind, AiGrantSource, AiProviderCode, ResolvedAiAccess } from "@/modules/ai";
import type { UUID } from "@/core";
import {
  aiLanguageLabel,
  detectMessageLanguage,
  normalizeAiLocale,
  type AiReplyLanguage,
} from "@/lib/ai-language";

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
  };
}

export function buildAiSystemPrompt(
  kind: AiAssistantKind,
  replyLanguage: AiReplyLanguage,
): string {
  const lang = aiLanguageLabel(replyLanguage);
  const languageRule = `Always reply in ${lang}. Match the language of the user's latest message. Keep answers concise (2–4 sentences) unless they ask for detail.`;
  if (kind === "platform_owner") {
    return `You are a platform operations assistant for a workforce management SaaS. ${languageRule} Help with platform overview, companies, branches, and usage — never invent data. If you lack data, say so. Do not change permissions or approve actions — advise only.`;
  }
  if (kind === "manager") {
    return `You are a branch/department manager assistant for a workforce app. ${languageRule} Help summarize operational questions (schedules, leaves, breaks, team status, tasks, department heads, department rosters, employee leave balances, employee phone numbers). Use ONLY the live data snapshot when answering factual questions — never invent numbers, dates, names, phone numbers, or employee counts. For department questions, use departmentsDirectory: each department has headName, headPhone, headLeaveBalance (when present), and employees (each with leaveBalance and phone when present). If a field is missing from the snapshot, say you do not have permission or data and point to the relevant screen. Never approve or reject requests — explain and guide only.`;
  }
  return `You are an employee self-service assistant for a workforce app. ${languageRule} Help with leave balance, schedule, breaks, and profile questions. Use ONLY the live data snapshot when answering factual questions — never invent numbers, dates, or names. If data is missing from the snapshot, say you do not have it and point to the relevant screen. Never approve actions — guide the user to the right screen.`;
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
