/**
 * Provider-agnostic AI router — dispatches to the configured backend.
 * Implementations added per phase; keys stay on the server only.
 */

import type { AiProviderCode } from "./ai.model";
import { aiErrorCode } from "@/lib/ai-errors";

export interface AiChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiChatRequest {
  providerCode: AiProviderCode;
  model?: string;
  messages: AiChatMessage[];
  maxOutputTokens?: number;
}

export interface AiChatResponse {
  providerCode: AiProviderCode;
  model: string;
  text: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
}

export interface AiProviderAdapter {
  code: AiProviderCode;
  chat(request: AiChatRequest): Promise<AiChatResponse>;
}

/** Registry populated at server bootstrap — not hard-coded to one vendor. */
const adapters = new Map<AiProviderCode, AiProviderAdapter>();

export function registerAiProvider(adapter: AiProviderAdapter): void {
  adapters.set(adapter.code, adapter);
}

export async function routeAiChat(request: AiChatRequest): Promise<AiChatResponse> {
  const adapter = adapters.get(request.providerCode);
  if (!adapter) {
    throw new Error(aiErrorCode("providerNotRegistered"));
  }
  return adapter.chat(request);
}
