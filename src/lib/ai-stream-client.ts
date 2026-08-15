import { supabase } from "@/integrations/supabase/client";
import { translateAiError } from "@/lib/ai-errors";
import type { TFunction } from "i18next";

export type AiStreamHistoryMessage = { role: "user" | "assistant"; content: string };

export type AiStreamResult = {
  text: string;
  remainingMinutes: number | null;
  model: string;
  providerCode: string;
};

export async function streamAiChatMessage(
  input: {
    message: string;
    history?: AiStreamHistoryMessage[];
    locale?: string;
  },
  onDelta: (text: string) => void,
): Promise<AiStreamResult> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Unauthorized");

  const res = await fetch("/api/ai/chat-stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });

  if (!res.ok && !res.headers.get("content-type")?.includes("text/event-stream")) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(typeof err.error === "string" ? err.error : "Request failed");
  }

  if (!res.body) throw new Error("Empty response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let remainingMinutes: number | null = null;
  let model = "";
  let providerCode = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data: "));
      if (!dataLine) continue;
      const payload = JSON.parse(dataLine.slice(6)) as {
        type: string;
        text?: string;
        message?: string;
        remainingMinutes?: number | null;
        model?: string;
        providerCode?: string;
      };

      if (payload.type === "chunk" && payload.text) {
        fullText += payload.text;
        onDelta(fullText);
      } else if (payload.type === "done") {
        if (payload.text) fullText = payload.text;
        remainingMinutes = payload.remainingMinutes ?? null;
        model = payload.model ?? model;
        providerCode = payload.providerCode ?? providerCode;
        onDelta(fullText);
      } else if (payload.type === "error") {
        throw new Error(payload.message ?? "AI stream error");
      }
    }
  }

  return { text: fullText, remainingMinutes, model, providerCode };
}

export function translateStreamError(error: unknown, t: TFunction): string {
  if (error instanceof Error) return translateAiError(error.message, t);
  return translateAiError(String(error), t);
}
