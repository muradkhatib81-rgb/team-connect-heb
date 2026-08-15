import { getGeminiApiKey } from "@/integrations/supabase/ai-env.server";
import type { AiProviderAdapter, AiChatRequest, AiChatResponse } from "../ai.router";

export class GeminiProvider implements AiProviderAdapter {
  readonly code = "gemini" as const;

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
    throw new Error(aiErrorCode("geminiNotConfigured"));
    }

    const model = request.model ?? "gemini-2.0-flash";
    const started = Date.now();

    const contents = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const systemInstruction = request.messages.find((m) => m.role === "system")?.content;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: request.maxOutputTokens ?? 1024,
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    const text =
      json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
      "לא התקבלה תשובה מהמודל.";

    return {
      providerCode: "gemini",
      model,
      text,
      inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
      durationMs: Date.now() - started,
    };
  }
}
