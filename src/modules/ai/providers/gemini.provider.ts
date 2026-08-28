import { getGeminiApiKey } from "@/integrations/supabase/ai-env.server";
import { aiErrorCode } from "@/lib/ai-errors";
import { resolveGeminiModel } from "../ai.model";
import type { AiProviderAdapter, AiChatRequest, AiChatResponse } from "../ai.router";

const CHAT_MAX_OUTPUT_TOKENS = 512;

export type GeminiUsage = { inputTokens: number; outputTokens: number };

function isGemini3Model(model: string): boolean {
  return model.startsWith("gemini-3");
}

function buildGenerationConfig(request: AiChatRequest, model: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    maxOutputTokens: request.maxOutputTokens ?? CHAT_MAX_OUTPUT_TOKENS,
  };
  if (isGemini3Model(model)) {
    config.thinkingConfig = { thinkingLevel: "minimal" };
  }
  return config;
}

function buildGeminiRequestBody(request: AiChatRequest, model: string): Record<string, unknown> {
  const contents = request.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const systemInstruction = request.messages.find((m) => m.role === "system")?.content;

  const body: Record<string, unknown> = {
    contents,
    generationConfig: buildGenerationConfig(request, model),
  };
  if (systemInstruction) {
    body.systemInstruction = { parts: [{ text: systemInstruction }] };
  }
  return body;
}

type GeminiPart = { text?: string; thought?: boolean; thoughtSignature?: string };

function extractGeminiText(json: {
  candidates?: { content?: { parts?: GeminiPart[] } }[];
}): string {
  const parts = json.candidates?.[0]?.content?.parts ?? [];
  return parts
    .filter((p) => typeof p.text === "string" && p.text.length > 0 && !p.thought)
    .map((p) => p.text ?? "")
    .join("");
}

function extractGeminiUsage(json: {
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}): GeminiUsage | undefined {
  if (!json.usageMetadata) return undefined;
  return {
    inputTokens: json.usageMetadata.promptTokenCount ?? 0,
    outputTokens: json.usageMetadata.candidatesTokenCount ?? 0,
  };
}

async function* parseGeminiSse(body: ReadableStream<Uint8Array>): AsyncGenerator<{
  textDelta: string;
  usage?: GeminiUsage;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let seenText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = dataLine.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;

      try {
        const json = JSON.parse(payload) as {
          candidates?: { content?: { parts?: GeminiPart[] } }[];
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        };
        const chunkText = extractGeminiText(json);
        const usage = extractGeminiUsage(json);
        // Gemini SSE sends incremental chunks; guard against cumulative repeats.
        let textDelta = chunkText;
        if (chunkText.startsWith(seenText)) {
          textDelta = chunkText.slice(seenText.length);
          seenText = chunkText;
        } else if (chunkText) {
          seenText += chunkText;
        }
        if (textDelta || usage) {
          yield { textDelta, usage };
        }
      } catch {
        // skip malformed SSE chunk
      }
    }
  }

  if (buffer.trim()) {
    const dataLine = buffer.split("\n").find((line) => line.startsWith("data: "));
    if (dataLine) {
      const payload = dataLine.slice(6).trim();
      if (payload && payload !== "[DONE]") {
        try {
          const json = JSON.parse(payload) as {
            candidates?: { content?: { parts?: GeminiPart[] } }[];
            usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
          };
          const chunkText = extractGeminiText(json);
          const usage = extractGeminiUsage(json);
          let textDelta = chunkText;
          if (chunkText.startsWith(seenText)) {
            textDelta = chunkText.slice(seenText.length);
          } else if (chunkText) {
            seenText += chunkText;
          }
          if (textDelta || usage) {
            yield { textDelta, usage };
          }
        } catch {
          // ignore tail parse errors
        }
      }
    }
  }
}

export async function streamGeminiChat(request: AiChatRequest): Promise<{
  model: string;
  stream: AsyncGenerator<{ textDelta: string; usage?: GeminiUsage }>;
}> {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    throw new Error(aiErrorCode("geminiNotConfigured"));
  }

  const model = resolveGeminiModel(request.model);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGeminiRequestBody(request, model)),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (${res.status}): ${errText.slice(0, 300)}`);
  }

  if (!res.body) {
    throw new Error("Gemini API error: empty stream body");
  }

  return { model, stream: parseGeminiSse(res.body) };
}

export class GeminiProvider implements AiProviderAdapter {
  readonly code = "gemini" as const;

  async chat(request: AiChatRequest): Promise<AiChatResponse> {
    const started = Date.now();
    const { model, stream } = await streamGeminiChat(request);

    let text = "";
    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of stream) {
      text += chunk.textDelta;
      if (chunk.usage) {
        inputTokens = chunk.usage.inputTokens;
        outputTokens = chunk.usage.outputTokens;
      }
    }

    return {
      providerCode: "gemini",
      model,
      text: text || "",
      inputTokens,
      outputTokens,
      durationMs: Date.now() - started,
    };
  }
}
