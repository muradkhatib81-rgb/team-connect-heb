import { getOpenAiApiKey } from "@/integrations/supabase/ai-env.server";
import { aiErrorCode } from "@/lib/ai-errors";
import { resolveOpenAiModel } from "../ai.model";
import type { AiProviderAdapter, AiChatRequest, AiChatResponse } from "../ai.router";

const CHAT_MAX_OUTPUT_TOKENS = 512;

export class OpenAiProvider implements AiProviderAdapter {
  readonly code = "openai" as const;

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const apiKey = getOpenAiApiKey();
    if (!apiKey) {
      throw new Error(aiErrorCode("openaiNotConfigured"));
    }

    const started = Date.now();
    const model = resolveOpenAiModel(request.model);
    const system = request.messages.find((m) => m.role === "system")?.content;
    const messages = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role, content: m.content }));

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: system ? [{ role: "system", content: system }, ...messages] : messages,
        max_tokens: request.maxOutputTokens ?? CHAT_MAX_OUTPUT_TOKENS,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`OpenAI API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: { message?: { content?: string | null } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    return {
      providerCode: "openai",
      model,
      text: json.choices?.[0]?.message?.content?.trim() || "",
      inputTokens: json.usage?.prompt_tokens ?? 0,
      outputTokens: json.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - started,
    };
  }
}
