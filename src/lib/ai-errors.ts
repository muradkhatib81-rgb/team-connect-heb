import type { TFunction } from "i18next";

export function aiErrorCode(key: string): string {
  return `AI_ERROR:${key}`;
}

export function isAiErrorCode(message: string): boolean {
  return message.startsWith("AI_ERROR:");
}

export function translateAiError(message: string, t: TFunction): string {
  if (!isAiErrorCode(message)) return message;
  const key = message.slice("AI_ERROR:".length);
  return t(`ai.errors.${key}`, { defaultValue: message });
}
