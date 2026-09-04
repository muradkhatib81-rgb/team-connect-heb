import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import type { AiAssistantKind } from "@/modules/ai";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import {
  streamAiChatMessage,
  translateStreamError,
  type AiStreamPhase,
} from "@/lib/ai-stream-client";
import { warmAiContext } from "@/lib/ai.functions";

type ChatMessage = { role: "user" | "assistant"; content: string };

export function AiChatPanel({
  assistantKind,
  remainingMinutes,
}: {
  assistantKind: AiAssistantKind;
  remainingMinutes: number | null;
}) {
  const { t, i18n } = useTranslation();
  const locale = (i18n.language?.slice(0, 2) ?? "he") as "he" | "ar" | "en";
  const title = t(`ai.assistantTitle.${assistantKind}`);
  const warmContext = useServerFn(warmAiContext);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [remaining, setRemaining] = useState<number | null>(remainingMinutes);
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [phase, setPhase] = useState<AiStreamPhase | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Warm server context cache while the user reads the empty chat.
  useEffect(() => {
    void warmContext().catch(() => {
      /* best-effort warmup */
    });
  }, [warmContext]);

  async function handleSend() {
    const text = input.trim();
    if (!text || isStreaming) return;

    const history = messages.slice(-6);
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setInput("");
    setError(null);
    setStreamingText(null);
    setPhase("auth");
    setIsStreaming(true);

    try {
      const result = await streamAiChatMessage(
        { message: text, history, locale },
        (partial) => {
          setStreamingText(partial);
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        },
        (nextPhase) => setPhase(nextPhase),
      );

      setMessages((prev) => [...prev, { role: "assistant", content: result.text }]);
      setRemaining(result.remainingMinutes);
    } catch (err) {
      setError(translateStreamError(err, t));
    } finally {
      setStreamingText(null);
      setPhase(null);
      setIsStreaming(false);
    }
  }

  const thinkingLabel =
    phase === "context"
      ? t("ai.preparingContext")
      : phase === "generating"
        ? t("ai.generating")
        : t("ai.thinking");

  return (
    <Card className="flex flex-col h-[min(70vh,640px)] overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="size-4 text-primary shrink-0" />
          <h2 className="font-semibold truncate">{title}</h2>
        </div>
        {remaining != null && (
          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
            {t("ai.remainingMinutes", { count: remaining })}
          </span>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !streamingText && (
          <p className="text-sm text-muted-foreground text-center py-8">{t("ai.emptyChat")}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={cn(
              "max-w-[90%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap",
              m.role === "user"
                ? "ms-auto bg-primary text-primary-foreground"
                : "me-auto bg-muted",
            )}
          >
            {m.content}
          </div>
        ))}
        {streamingText != null && streamingText.length > 0 && (
          <div className="me-auto max-w-[90%] rounded-xl bg-muted px-3 py-2 text-sm whitespace-pre-wrap">
            {streamingText}
            {isStreaming && (
              <span className="inline-block ms-1 animate-pulse text-muted-foreground">▍</span>
            )}
          </div>
        )}
        {isStreaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            {thinkingLabel}
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      <div className="border-t p-3 flex gap-2 items-end">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("ai.inputPlaceholder")}
          rows={2}
          className="min-h-[44px] resize-none"
          disabled={isStreaming}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
        />
        <Button
          type="button"
          size="icon"
          className="shrink-0"
          disabled={!input.trim() || isStreaming}
          onClick={() => void handleSend()}
        >
          <Send className="size-4" />
        </Button>
      </div>
    </Card>
  );
}
