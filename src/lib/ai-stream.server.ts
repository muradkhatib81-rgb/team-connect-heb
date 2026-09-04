import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { aiErrorCode } from "@/lib/ai-errors";
import {
  buildAiChatMessages,
  estimateAiMinutes,
  mapAiAccess,
  type RawAiAccess,
} from "@/lib/ai-chat-core.server";
import { buildAiUserContext } from "@/lib/ai-context.server";
import { streamGeminiChat } from "@/modules/ai/providers/gemini.provider";

const streamInput = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .max(20)
    .optional(),
  locale: z.string().optional(),
});

function sseEvent(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function createAiChatSseResponse(
  supabase: SupabaseClient<Database>,
  rawBody: unknown,
): Promise<Response> {
  const data = streamInput.parse(rawBody);

  // Open SSE immediately — access + context run inside the stream so the
  // client can show progress instead of waiting on a silent HTTP stall.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const push = (payload: unknown) => controller.enqueue(encoder.encode(sseEvent(payload)));

      let fullText = "";
      let inputTokens = 0;
      let outputTokens = 0;
      let model = "gemini";
      const started = Date.now();

      try {
        push({ type: "status", phase: "auth" });

        const { data: accessRaw, error: accessErr } = await supabase.rpc("get_my_ai_access");
        if (accessErr) {
          push({ type: "error", message: accessErr.message });
          controller.close();
          return;
        }

        const access = mapAiAccess((accessRaw ?? {}) as RawAiAccess);
        if (!access.allowed) {
          push({ type: "error", message: aiErrorCode("noAccess") });
          controller.close();
          return;
        }

        push({ type: "status", phase: "context" });

        const contextBlock = await buildAiUserContext(supabase, access.assistantKind);
        const messages = buildAiChatMessages({
          assistantKind: access.assistantKind,
          message: data.message,
          history: data.history,
          locale: data.locale,
          contextBlock,
        });

        push({ type: "status", phase: "generating" });

        const gemini = await streamGeminiChat({
          providerCode: access.providerCode,
          messages,
        });
        model = gemini.model;

        for await (const chunk of gemini.stream) {
          if (chunk.textDelta) {
            fullText += chunk.textDelta;
            push({ type: "chunk", text: chunk.textDelta });
          }
          if (chunk.usage) {
            inputTokens = chunk.usage.inputTokens;
            outputTokens = chunk.usage.outputTokens;
          }
        }

        if (!fullText.trim()) {
          throw new Error("AI_ERROR:emptyResponse");
        }

        const minutes = estimateAiMinutes(Date.now() - started, inputTokens, outputTokens);
        const remainingMinutes =
          access.remainingMinutes != null
            ? Math.max(0, Math.round((access.remainingMinutes - minutes) * 100) / 100)
            : null;

        // Tell the client the answer is ready before billing RPC (UI waits on "done").
        push({
          type: "done",
          text: fullText,
          remainingMinutes,
          providerCode: access.providerCode,
          model,
        });

        const { error: consumeErr } = await supabase.rpc("consume_ai_minutes", {
          _grant_id: access.grantId,
          _minutes: minutes,
          _provider_code: access.providerCode,
          _model: model,
          _assistant_kind: access.assistantKind,
          _input_tokens: inputTokens,
          _output_tokens: outputTokens,
          _duration_ms: Date.now() - started,
        });
        if (consumeErr) {
          console.error("[ai-stream] consume_ai_minutes failed:", consumeErr.message);
        }

        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        try {
          push({ type: "error", message });
        } catch {
          /* stream may already be closed */
        }
        try {
          controller.close();
        } catch {
          /* ignore */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
